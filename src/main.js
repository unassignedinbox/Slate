// Slate Road Editor — application controller.
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import './style.css';

import { RoadDocument, propCollections } from './model.js';
import { PROFILES, profileWidth } from './profiles.js';
import { generateCity } from './citygen.js';
import { Viewport } from './viewport.js';
import { UnrealCamera } from './camera.js';
import { buildShell, updateAxisWidget } from './ui.js';
import { openConstruct, closeConstruct } from './construct.js';
import { clamp, uid, fmt } from './util.js';
import * as THREE from 'three';

const STORAGE_KEY = 'slate-road-editor-doc-v1';

class Controller {
  constructor() {
    this.doc = new RoadDocument();
    this.selection = null;
    this.tool = 'select';
    this.drawPoints = [];
    this.drawMode = 'road'; // road | rail | subway
    this.drawProfile = 'boulevard';
    this.propKind = 'bollard';
    this.propRot = 0;
    this.genParams = {
      seed: 42,
      blocks: 6,
      rail: true,
      subway: true,
      river: true,
      busNetwork: true,
      bikeNetwork: true,
      parking: true,
      furniture: true,
      speedBumps: true,
    };
    this.history = [];
    this.future = [];
    this.hiddenKinds = new Set();
    this.lastConstructTab = 'roads';
    this._snapshot();
  }

  // ---------- history ----------
  _snapshot() {
    this.history.push(this.doc.serialize());
    if (this.history.length > 20) this.history.shift();
    this.future = [];
    scheduleAutosave(this.doc);
  }

  undo() {
    if (this.history.length < 2) {
      this.ui?.toast('Nothing to undo', 'warn');
      return;
    }
    this.future.push(this.history.pop());
    this.doc = RoadDocument.deserialize(this.history[this.history.length - 1]);
    this.selection = null;
    afterDocSwap(this);
  }

  redo() {
    if (!this.future.length) {
      this.ui?.toast('Nothing to redo', 'warn');
      return;
    }
    const snap = this.future.pop();
    this.history.push(snap);
    this.doc = RoadDocument.deserialize(snap);
    this.selection = null;
    afterDocSwap(this);
  }

  // ---------- scene accessors ----------
  getSceneName() {
    return this.doc.sceneName;
  }

  setSceneName(v) {
    this.doc.sceneName = v || 'Untitled City';
    this.ui?.refreshSceneName();
  }

  getSnap() {
    return this.doc.settings.gridSnap || 0;
  }

  setSnap(v) {
    this.doc.settings.gridSnap = v;
    this.ui?.setSnapUI(v);
  }

  getSelection() {
    return this.selection;
  }

  getDrawProfile() {
    return this.drawProfile;
  }

  getGenParams() {
    return { ...this.genParams };
  }

  setGenParams(p) {
    Object.assign(this.genParams, p);
  }

  getCameraSpeed() {
    return this.camera?.speed ?? 26;
  }

  setCameraSpeed(v) {
    if (this.camera) this.camera.speed = v;
    this.ui?.setSpeedUI(v);
  }

  // ---------- selection ----------
  select(id) {
    this.selection = id;
    this.viewport?.setSelection(id && !id.startsWith('coll:') ? id : null);
    this.ui?.updateAll();
    if (id) {
      const obj = this.doc.find(id);
      const name = obj?.name || (id.startsWith('coll:') ? id.slice(5) : id);
      this.ui?.setHint(`Selected: ${name}`);
    }
  }

  focusSelected() {
    if (!this.selection || this.selection.startsWith('coll:')) return;
    const obj = this.doc.find(this.selection);
    if (!obj) return;
    const target = { x: obj.x ?? obj.points?.[0]?.x ?? 0, y: 0, z: obj.z ?? obj.points?.[0]?.z ?? 0 };
    if (obj.points?.length) {
      const mid = obj.points[Math.floor(obj.points.length / 2)];
      target.x = mid.x;
      target.z = mid.z;
    }
    const radius = obj.points ? Math.min(90, Math.max(18, profileWidth(PROFILES[obj.profile] || PROFILES.street) * 1.4)) : 14;
    this.camera.focus(new (await_three()).Vector3(target.x, 2, target.z), radius);
    this.ui?.setHint(`Focused ${obj.name || obj.kind}`);
  }

  focusCollection(kind) {
    const items = this.doc.props.filter((p) => p.kind === kind);
    if (!items.length) return;
    const p = items[Math.floor(items.length / 2)];
    this.camera.focus(new (await_three()).Vector3(p.x, 2, p.z), 16);
  }

  // ---------- mutations ----------
  addDrawnSegment() {
    const pts = this.drawPoints.map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z }));
    if (pts.length < 2) return;
    if (this.drawMode === 'rail') {
      const rail = {
        id: uid('rl'),
        name: `Railway ${this.doc.rails.length + 1}`,
        points: pts,
        crossings: [],
      };
      this.doc.rails.push(rail);
      this._snapshot();
      this.doc.emit('structure');
      this.select(rail.id);
      this.ui?.toast('Railway added — level crossings can be generated with a city', 'ok');
    } else if (this.drawMode === 'subway') {
      const sw = {
        id: uid('sw'),
        name: `Metro ${this.doc.subways.length + 1}`,
        depth: -9,
        points: pts,
        stations: [
          { x: pts[0].x, z: pts[0].z, angle: 0, name: `Terminus A ${this.doc.subways.length + 1}` },
          { x: pts[pts.length - 1].x, z: pts[pts.length - 1].z, angle: 0, name: `Terminus B ${this.doc.subways.length + 1}` },
        ],
      };
      this.doc.subways.push(sw);
      this._snapshot();
      this.doc.emit('structure');
      this.select(sw.id);
      this.ui?.toast('Subway line added — tunnels, stations & platforms', 'ok');
    } else {
      const profile = PROFILES[this.drawProfile] || PROFILES.street;
      const seg = {
        id: uid('rd'),
        name: `${profile.name} · drawn ${this.doc.segments.length + 1}`,
        profile: this.drawProfile,
        points: pts,
        junctions: { start: false, end: false },
        bridge: false,
        overrides: {},
      };
      this.doc.segments.push(seg);
      this._snapshot();
      this.doc.emit('structure');
      this.select(seg.id);
      this.ui?.toast(`${profile.name} added (${fmt(profileWidth(profile), 1)} m wide)`, 'ok');
    }
    this.drawPoints = [];
  }

  placePropAt(x, z) {
    const prop = {
      id: uid('pr'),
      kind: this.propKind,
      name: this.propKind,
      x,
      y: 0.15,
      z,
      rotY: this.propRot,
      opts: this.propKind === 'sign-speed' ? { label: 50 } : {},
    };
    this.doc.props.push(prop);
    this._snapshot();
    this.doc.emit('structure');
    this.select(prop.id);
    this.ui?.setHint(`Placed ${this.propKind} — click to place another`);
  }

  updateSegment(id, patch, light = false) {
    const seg = this.doc.segments.find((s) => s.id === id);
    if (!seg) return;
    Object.assign(seg, patch);
    if (!light) this._snapshot();
    this.doc.emit('structure');
    if (light) {
      // cheap refresh for sliders: rebuild only on release-ish cadence
      clearTimeout(this._lightTimer);
      this._lightTimer = setTimeout(() => this.doc.emit('structure'), 120);
    }
    this.ui?.updateInspector();
  }

  updateProp(id, patch, light = false) {
    const prop = this.doc.props.find((p) => p.id === id);
    if (!prop) return;
    Object.assign(prop, patch);
    if (!light) this._snapshot();
    clearTimeout(this._lightTimer);
    this._lightTimer = setTimeout(() => this.doc.emit('structure'), 60);
    this.ui?.updateInspector();
  }

  deleteSelected() {
    const id = this.selection;
    if (!id) return;
    if (id.startsWith('coll:')) {
      this.deleteCollection(id.slice(5));
      return;
    }
    if (this.doc.remove(id)) {
      this._snapshot();
      this.selection = null;
      this.doc.emit('structure');
      this.ui?.toast('Deleted', 'ok');
    }
  }

  deleteCollection(kind) {
    const before = this.doc.props.length;
    this.doc.props = this.doc.props.filter((p) => p.kind !== kind);
    if (this.doc.props.length !== before) {
      this._snapshot();
      this.selection = null;
      this.doc.emit('structure');
      this.ui?.toast(`Deleted all ${kind}s`, 'ok');
    }
  }

  duplicateSelected() {
    const obj = this.doc.find(this.selection);
    if (!obj) return;
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = uid(copy.id.split('-')[0]);
    copy.name = `${obj.name} copy`;
    if (copy.points) copy.points = copy.points.map((p) => ({ ...p, x: p.x + 10, z: p.z + 10 }));
    if ('x' in copy) {
      copy.x += 6;
      copy.z += 6;
    }
    if (this.doc.segments.includes(obj)) this.doc.segments.push(copy);
    else if (this.doc.props.includes(obj)) this.doc.props.push(copy);
    else return;
    this._snapshot();
    this.doc.emit('structure');
    this.select(copy.id);
    this.ui?.toast('Duplicated', 'ok');
  }

  toggleHidden(id, hidden) {
    if (id.startsWith('coll:')) {
      const kind = id.slice(5);
      if (hidden) this.hiddenKinds.add(kind);
      else this.hiddenKinds.delete(kind);
      this.doc.hiddenKinds = [...this.hiddenKinds];
      this.doc.emit('structure');
      return;
    }
    const obj = this.doc.find(id);
    if (!obj) return;
    obj.hidden = hidden;
    this.doc.emit('structure');
  }

  toggleGrid() {
    const v = !this.doc.settings.showGrid;
    this.viewport?.setGridVisible(v);
    return v;
  }

  clearScene() {
    this.doc.clear();
    this._snapshot();
    this.selection = null;
    this.doc.emit('structure');
    this.ui?.toast('Scene cleared', 'ok');
  }

  generateCity(params) {
    const p = params || this.genParams;
    Object.assign(this.genParams, p);
    generateCity(this.doc, p);
    this._snapshot();
    this.selection = null;
    this.doc.emit('structure');
    // frame the city
    this.camera.speed = 40;
    this.ui?.setSpeedUI(40);
    this.camera.focus(new (await_three()).Vector3(0, 2, 0), 260);
    this.ui?.toast(`City generated · seed ${p.seed}`, 'ok');
    this.ui?.updateAll();
  }

  // ---------- tools ----------
  setTool(tool) {
    this.tool = tool;
    if (tool !== 'draw') {
      this.drawPoints = [];
      this.viewport?.clearGhost();
    }
    if (tool !== 'prop') this.viewport?.clearGhost();
    this.ui?.setToolUI(tool);
  }

  startDrawRoad(profileKey) {
    this.drawMode = 'road';
    if (profileKey) this.drawProfile = profileKey;
    this.setTool('draw');
    const p = PROFILES[this.drawProfile];
    this.ui?.toast(`Draw tool · ${p.name} — click to place points`, 'ok');
  }

  startDrawRail(mode) {
    this.drawMode = mode;
    this.setTool('draw');
    this.ui?.toast(mode === 'rail' ? 'Draw railway — click to place alignment points' : 'Draw subway — click to place alignment points', 'ok');
  }

  startPlaceProp(kind) {
    this.propKind = kind;
    this.setTool('prop');
    this.ui?.toast(`Placing ${kind} — click on the ground`, 'ok');
  }

  // ---------- files ----------
  exportJSON() {
    const blob = new Blob([this.doc.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.doc.sceneName.replace(/[^\w-]+/g, '_')}.slate.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.ui?.toast('Scene exported', 'ok');
  }

  importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          this.doc = RoadDocument.deserialize(String(reader.result));
          this._snapshot();
          this.selection = null;
          afterDocSwap(this);
          this.ui?.toast('Scene imported', 'ok');
        } catch {
          this.ui?.toast('Import failed — invalid JSON', 'warn');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  openConstruct() {
    openConstruct(this);
  }
}

// three.js reference for camera helpers (Vector3)
const THREEref = THREE;
function await_three() {
  return THREEref;
}

let autosaveTimer = null;
function scheduleAutosave(doc) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, doc.serialize());
    } catch {
      /* storage full or blocked */
    }
  }, 900);
}

function afterDocSwap(ctrl) {
  scheduleAutosave(ctrl.doc);
  ctrl.attachDoc();
  ctrl.ui?.updateAll();
  ctrl.rebuild();
}

function snapValue(v, snap) {
  if (!snap) return Math.round(v * 100) / 100;
  return Math.round(v / snap) * snap;
}

async function boot() {
  const ctrl = new Controller();

  // shell + viewport
  const ui = buildShell(ctrl);
  ctrl.ui = ui;

  const viewport = new Viewport(ui.viewportEl, ctrl.doc);
  ctrl.viewport = viewport;
  const camera = new UnrealCamera(viewport.camera, viewport.canvas);
  ctrl.camera = camera;
  camera.onSpeedChange = (v) => ui.setSpeedUI(v);

  // rebuild hook used by doc swaps
  ctrl.rebuild = () => {
    viewport.rebuild();
  };

  // doc changes -> rebuild geometry + refresh UI
  let rebuildTimer = null;
  ctrl.attachDoc = () => {
    ctrl.doc.hiddenKinds = [...ctrl.hiddenKinds];
    ctrl.doc.onChange(() => {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        viewport.rebuild();
        ui.updateAll();
      }, 30);
    });
  };
  ctrl.attachDoc();

  // restore or generate
  const saved = localStorage.getItem(STORAGE_KEY);
  let restored = false;
  if (saved) {
    try {
      ctrl.doc = RoadDocument.deserialize(saved);
      restored = ctrl.doc.segments.length > 0;
      if (restored) {
        ctrl.attachDoc();
        ctrl._snapshot();
      }
    } catch {
      restored = false;
    }
  }
  if (!restored) {
    generateCity(ctrl.doc, ctrl.genParams);
    ctrl._snapshot();
  }
  viewport.rebuild();
  ui.updateAll();
  ui.setSnapUI(ctrl.getSnap());
  ui.setViewUI('lit');

  // place camera to overlook the city
  camera.focus(new THREE.Vector3(40, 0, 60), 300);

  // ---------------- input: viewport ----------------
  const canvas = viewport.canvas;
  let downPos = null;

  canvas.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY, button: e.button };
    if (e.button !== 0) return;
    if (e.altKey) return; // orbit handled by camera
    if (ctrl.tool === 'draw') {
      const p = viewport.groundPoint(e.clientX, e.clientY);
      if (p) {
        const snap = ctrl.getSnap();
        ctrl.drawPoints.push({
          x: snapValue(p.x, snap),
          y: 0,
          z: snapValue(p.z, snap),
        });
        const profileKey = ctrl.drawMode === 'road' ? ctrl.drawProfile : 'street';
        viewport.setGhost(ctrl.drawPoints, null, profileKey);
      }
    } else if (ctrl.tool === 'prop') {
      const p = viewport.groundPoint(e.clientX, e.clientY);
      if (p) {
        const snap = ctrl.getSnap();
        ctrl.placePropAt(snapValue(p.x, snap), snapValue(p.z, snap));
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = viewport.groundPoint(e.clientX, e.clientY);
    if (p) ui.setCoords(p.x, p.z);
    if (ctrl.tool === 'draw' && ctrl.drawPoints.length) {
      const profileKey = ctrl.drawMode === 'road' ? ctrl.drawProfile : 'street';
      viewport.setGhost(
        ctrl.drawPoints,
        p ? { x: snapValue(p.x, ctrl.getSnap()), y: 0, z: snapValue(p.z, ctrl.getSnap()) } : null,
        profileKey
      );
    } else if (ctrl.tool === 'prop') {
      viewport.setPropGhost(ctrl.propKind, p ? { x: snapValue(p.x, ctrl.getSnap()), y: 0.15, z: snapValue(p.z, ctrl.getSnap()) } : null, ctrl.propRot);
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    const wasClick = moved < 5 && downPos.button === 0 && !e.altKey;
    downPos = null;
    if (!wasClick) return;
    if (ctrl.tool === 'select') {
      const hit = viewport.pick(e.clientX, e.clientY);
      ctrl.select(hit?.id || null);
    }
  });

  canvas.addEventListener('dblclick', () => {
    if (ctrl.tool === 'draw' && ctrl.drawPoints.length >= 2) {
      ctrl.addDrawnSegment();
      viewport.clearGhost();
    } else if (ctrl.tool === 'select') {
      ctrl.focusSelected();
    }
  });

  // ---------------- hotkeys ----------------
  window.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    if (typing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) ctrl.redo();
      else ctrl.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      ctrl.openConstruct();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v':
        ctrl.setTool('select');
        break;
      case 'r':
        ctrl.startDrawRoad();
        break;
      case 'p':
        ctrl.setTool('prop');
        break;
      case 'k':
        ctrl.openConstruct();
        break;
      case 'g':
        ctrl.generateCity();
        break;
      case 'f':
        ctrl.focusSelected();
        break;
      case 'x':
        if (ctrl.tool === 'prop') {
          ctrl.propRot += Math.PI / 12;
          ui.setHint(`Rotation ${Math.round((ctrl.propRot * 180) / Math.PI)}°`);
        }
        break;
      case '1':
        ctrl.setViewMode?.('lit');
        break;
      case '2':
        ctrl.setViewMode?.('classes');
        break;
      case '3':
        ctrl.setViewMode?.('wire');
        break;
      case '4':
        ctrl.setViewMode?.('subway');
        break;
      case 'delete':
      case 'backspace':
        ctrl.deleteSelected();
        break;
      case 'escape':
        closeConstruct();
        if (ctrl.tool === 'draw' && ctrl.drawPoints.length) {
          ctrl.drawPoints = [];
          viewport.clearGhost();
          ui.setHint('Draw cancelled');
        } else {
          ctrl.select(null);
        }
        break;
      case 'enter':
        if (ctrl.tool === 'draw' && ctrl.drawPoints.length >= 2) {
          ctrl.addDrawnSegment();
          viewport.clearGhost();
        }
        break;
      default:
        break;
    }
  });

  ctrl.setViewMode = (mode) => {
    viewport.applyViewMode(mode);
    ui.setViewUI(mode);
    ui.setHint(
      mode === 'subway' ? 'Subway X-ray — ground faded to reveal tunnels & stations' :
      mode === 'classes' ? 'Class map — one colour per road class' :
      mode === 'wire' ? 'Wireframe debug view' : 'Lit view'
    );
  };

  // ---------------- render loop ----------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    viewport.render(dt, camera);
    ui.setFps(viewport.fps);
    updateAxisWidget((-camera.yaw * 180) / Math.PI + 90);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // expose for debugging
  window.slate = { ctrl, viewport, camera };
  ui.toast('City ready — RMB to look around, WASD to fly, K for Construct', 'ok');
}

boot();
