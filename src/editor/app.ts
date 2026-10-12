// The editor: owns the network document, undo history, tools and the 3D scene.
import * as THREE from 'three';
import { V3, V, Sampled, at, nearest, dist2 } from '../core/geometry';
import {
  Network, Road, Prop, PropKind, PRESETS, Lane, LaneKind, parseNetwork, makeRoad, emptyNetwork, uid, roadWidth, laneBands, LANE_RAISE,
} from '../core/model';
import { generateCity, CityOptions, DEFAULT_CITY } from '../core/city';
import { buildNetwork, NetworkMesh, sampleRoad } from '../render/network-mesh';
import { NetworkView } from '../render/view';
import { groundMaterial } from '../render/materials';
import { FlyCamera } from './camera';

export type Tool = 'select' | 'draw' | 'prop' | 'erase';
export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Select / move', key: '1', hint: 'Click a road to select it. Drag its white handles to reshape. PageUp/PageDown raise or lower the selected point.' },
  { id: 'draw', label: 'Draw road', key: '2', hint: 'Click to add points. Double-click or Enter to finish, Esc to cancel. Snap is on unless toggled off.' },
  { id: 'prop', label: 'Place prop', key: '3', hint: 'Click next to a road to drop the chosen prop (bollard, speed bump, lamp, bus stop, subway entrance).' },
  { id: 'erase', label: 'Erase', key: '4', hint: 'Click a road or prop to delete it.' },
];

const STORAGE_KEY = 'slate-road-editor:v1';
const MAX_UNDO = 120;

export class Editor {
  net: Network = emptyNetwork();
  tool: Tool = 'select';
  drawPreset = 'arterial';
  propKind: PropKind = 'bollard';
  snapOn = true;
  snapStep = 1;
  selRoad: string | null = null;
  selPoint: number | null = null;
  selProp: string | null = null;
  mesh: NetworkMesh | null = null;
  stats = { buildMs: 0 };
  onChange: () => void = () => {};

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private draft: V3[] = [];
  private draftHover: V3 | null = null;
  private drag: { roadId: string; idx: number; before: string } | null = null;
  private rebuildQueued = false;
  private saveTimer = 0;

  // three.js
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fly: FlyCamera;
  readonly view: NetworkView;
  private overlay = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private selLine: THREE.Line | null = null;
  private draftLine: THREE.Line | null = null;
  private propMarker: THREE.Mesh | null = null;
  private ray = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private ndc = new THREE.Vector2();
  private lastX = 0;
  private lastY = 0;
  private propPos = new Map<string, V3>();
  private sampledCache = new Map<string, Sampled>();

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = false;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xaccde3);
    this.scene.fog = new THREE.Fog(0xaccde3, 5000, 26000);
    this.scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x4a5b3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(600, 900, 400);
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), groundMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.name = 'ground';
    this.scene.add(ground);
    const grid = new THREE.GridHelper(4000, 400, 0x2b3a22, 0x2b3a22);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    grid.position.y = 0.02;
    this.scene.add(grid);

    this.camera = new THREE.PerspectiveCamera(60, host.clientWidth / Math.max(1, host.clientHeight), 0.5, 60000);
    this.fly = new FlyCamera(this.camera);
    this.view = new NetworkView(this.scene);
    this.scene.add(this.overlay);

    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('dblclick', () => this.tool === 'draw' && this.finishDraw());
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.fly.wheel(e.deltaY); }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.fly.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.fly.keys.clear());
    window.addEventListener('resize', () => this.resize());

    this.loadOrGenerate();
    this.animate();
  }

  // ---------------------------------------------------------------- lifecycle
  private animate = (): void => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fly.update(dt);
    this.updateHandleScale();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };

  resize(): void {
    const w = this.host.clientWidth;
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loadOrGenerate(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.net = parseNetwork(JSON.parse(raw));
        this.rebuild();
        this.frameAll();
        return;
      }
    } catch {
      // Fall through to a fresh city if the saved document is unreadable.
    }
    this.generateCity({ ...DEFAULT_CITY, blocks: 14 }, true);
    this.frameAll();
  }

  // ---------------------------------------------------------------- document ops
  /** Apply a mutation as one undoable step. */
  private mutate(fn: (n: Network) => void): void {
    const before = JSON.stringify(this.net);
    fn(this.net);
    const after = JSON.stringify(this.net);
    if (after === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.rebuild();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.net));
    this.net = JSON.parse(prev);
    this.afterHistory();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.net));
    this.net = JSON.parse(next);
    this.afterHistory();
  }

  private afterHistory(): void {
    this.sanitiseSelection();
    this.rebuild();
  }

  private sanitiseSelection(): void {
    if (this.selRoad && !this.net.roads.some((r) => r.id === this.selRoad)) {
      this.selRoad = null;
      this.selPoint = null;
    }
    if (this.selProp && !this.net.props.some((p) => p.id === this.selProp)) this.selProp = null;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  rebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.rebuildNow();
    });
  }

  private rebuildNow(): void {
    const t0 = performance.now();
    this.mesh = buildNetwork(this.net);
    this.sampledCache = this.mesh.sampled;
    this.view.set(this.mesh);
    this.propPos.clear();
    for (const p of this.net.props) {
      const S = this.sampledCache.get(p.roadId);
      if (!S) continue;
      const h = at(S, p.s);
      this.propPos.set(p.id, V(h.p.x + h.n.x * p.offset, h.p.y, h.p.z + h.n.z * p.offset));
    }
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.updateOverlay();
    this.scheduleSave();
    this.onChange();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.net));
      } catch {
        // Storage may be full for very large cities; the export button always works.
      }
    }, 400);
  }

  getRoad(id: string | null): Road | undefined {
    return id ? this.net.roads.find((r) => r.id === id) : undefined;
  }

  getProp(id: string | null): Prop | undefined {
    return id ? this.net.props.find((p) => p.id === id) : undefined;
  }

  updateRoad(id: string, patch: Partial<Road>): void {
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
  }

  setRoadPreset(id: string, key: string): void {
    const p = PRESETS[key];
    if (!p) return;
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === id);
      if (!r) return;
      r.preset = key;
      r.category = p.category;
      r.surface = p.surface;
      r.speedLimit = p.speedLimit;
      r.smooth = p.smooth;
      r.lanes = p.lanes.map((l) => ({ ...l }));
    });
  }

  updateLane(roadId: string, idx: number, patch: Partial<Lane>): void {
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === roadId);
      if (r && r.lanes[idx]) Object.assign(r.lanes[idx], patch);
    });
  }

  moveLane(roadId: string, idx: number, dir: -1 | 1): void {
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === roadId);
      if (!r) return;
      const j = idx + dir;
      if (j < 0 || j >= r.lanes.length) return;
      [r.lanes[idx], r.lanes[j]] = [r.lanes[j], r.lanes[idx]];
    });
  }

  addLane(roadId: string, kind: LaneKind = 'driving'): void {
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === roadId);
      if (r) r.lanes.push({ kind, width: 3.2, dir: kind === 'driving' ? 1 : 0 });
    });
  }

  removeLane(roadId: string, idx: number): void {
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === roadId);
      if (r) r.lanes.splice(idx, 1);
    });
  }

  setPointHeight(roadId: string, idx: number, y: number): void {
    this.mutate((n) => {
      const r = n.roads.find((x) => x.id === roadId);
      if (r && r.points[idx]) r.points[idx].y = y;
    });
  }

  deleteRoad(id: string): void {
    this.mutate((n) => {
      n.roads = n.roads.filter((r) => r.id !== id);
      n.props = n.props.filter((p) => p.roadId !== id);
    });
    if (this.selRoad === id) {
      this.selRoad = null;
      this.selPoint = null;
    }
    this.onChange();
  }

  updateProp(id: string, patch: Partial<Prop>): void {
    this.mutate((n) => {
      const p = n.props.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    });
  }

  deleteProp(id: string): void {
    this.mutate((n) => {
      n.props = n.props.filter((p) => p.id !== id);
    });
    if (this.selProp === id) this.selProp = null;
    this.onChange();
  }

  deleteSelection(): void {
    if (this.selProp) this.deleteProp(this.selProp);
    else if (this.selRoad) this.deleteRoad(this.selRoad);
  }

  generateCity(opts: CityOptions, replace = true): void {
    const city = generateCity(opts);
    this.mutate((n) => {
      if (replace) {
        n.roads = [];
        n.props = [];
      }
      n.roads.push(...city.roads);
      n.props.push(...city.props);
    });
    this.selRoad = null;
    this.selProp = null;
    this.selPoint = null;
    this.onChange();
  }

  clearAll(): void {
    this.mutate((n) => {
      n.roads = [];
      n.props = [];
    });
    this.selRoad = this.selProp = null;
    this.selPoint = null;
    this.onChange();
  }

  exportJSON(): string {
    return JSON.stringify(this.net, null, 2);
  }

  importJSON(text: string): void {
    const parsed = parseNetwork(JSON.parse(text));
    this.undoStack.push(JSON.stringify(this.net));
    this.redoStack = [];
    this.net = parsed;
    this.selRoad = this.selProp = null;
    this.selPoint = null;
    this.rebuild();
    this.frameAll();
    this.onChange();
  }

  // ---------------------------------------------------------------- tools & selection
  setTool(t: Tool): void {
    if (this.tool === 'draw' && t !== 'draw') this.cancelDraw();
    this.tool = t;
    this.onChange();
  }

  selectRoad(id: string | null, point: number | null = null): void {
    this.selRoad = id;
    this.selPoint = point;
    this.selProp = null;
    this.updateOverlay();
    this.onChange();
  }

  selectProp(id: string | null): void {
    this.selProp = id;
    this.selRoad = null;
    this.selPoint = null;
    this.updateOverlay();
    this.onChange();
  }

  finishDraw(): void {
    if (this.draft.length >= 2) {
      const road = makeRoad(this.drawPreset, this.draft);
      this.mutate((n) => n.roads.push(road));
      this.selectRoad(road.id);
    }
    this.draft = [];
    this.draftHover = null;
    this.updateOverlay();
    this.onChange();
  }

  cancelDraw(): void {
    this.draft = [];
    this.draftHover = null;
    this.updateOverlay();
  }

  get draftCount(): number { return this.draft.length; }

  // ---------------------------------------------------------------- picking
  private setRay(e: PointerEvent | MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private groundHit(y = 0): V3 | null {
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (y - o.y) / d.y;
    if (t < 0) return null;
    return V(o.x + d.x * t, y, o.z + d.z * t);
  }

  private snap(p: V3): V3 {
    if (!this.snapOn) return p;
    const st = this.snapStep;
    return V(Math.round(p.x / st) * st, p.y, Math.round(p.z / st) * st);
  }

  /** Nearest carriage road/path to a ground point within `maxDist`, with its hit data. */
  pickRoad(p: V3, maxDist = 12): { road: Road; hit: NonNullable<ReturnType<typeof nearest>> } | null {
    let best: { road: Road; hit: NonNullable<ReturnType<typeof nearest>> } | null = null;
    for (const r of this.net.roads) {
      const S = this.sampledCache.get(r.id);
      if (!S) continue;
      const hit = nearest(S, p);
      if (!hit) continue;
      const half = r.category === 'rail' ? 2.5 : roadWidth(r) / 2;
      const limit = Math.max(maxDist * 0.5, half + 2.5);
      if (hit.dist <= limit && (!best || hit.dist < best.hit.dist)) best = { road: r, hit };
    }
    return best;
  }

  private pickProp(p: V3): Prop | null {
    let best: Prop | null = null;
    let bd = 3.0;
    for (const pr of this.net.props) {
      const q = this.propPos.get(pr.id);
      if (!q) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) {
        bd = d;
        best = pr;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- pointer
  private onPointerDown(e: PointerEvent): void {
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (e.button === 2) {
      this.fly.rmb = true;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    this.setRay(e);
    if (this.tool === 'draw') {
      const g = this.groundHit(0);
      if (!g) return;
      const p = this.snap(g);
      if (this.draft.length >= 3 && dist2(p, this.draft[0]) < 4) {
        this.finishDraw();
        return;
      }
      this.draft.push(p);
      this.updateOverlay();
      this.onChange();
      return;
    }
    if (this.tool === 'select') {
      const hit = this.ray.intersectObjects(this.handles, false)[0];
      if (hit && this.selRoad) {
        const idx = hit.object.userData.idx as number;
        const road = this.getRoad(this.selRoad)!;
        this.selPoint = idx;
        this.drag = { roadId: road.id, idx, before: JSON.stringify(this.net) };
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.updateOverlay();
        this.onChange();
        return;
      }
      const g = this.groundHit(0);
      if (!g) return;
      const pr = this.pickProp(g);
      if (pr) {
        this.selectProp(pr.id);
        return;
      }
      const pick = this.pickRoad(g);
      if (pick) this.selectRoad(pick.road.id, null);
      else this.selectRoad(null);
      return;
    }
    if (this.tool === 'prop') {
      const g = this.groundHit(0);
      if (!g) return;
      const pick = this.pickRoad(g, 20);
      if (!pick || pick.road.category === 'rail' || pick.road.category === 'subway') return;
      const offset = Math.round(pick.hit.offset * 10) / 10;
      const prop: Prop = { id: uid('p_'), kind: this.propKind, roadId: pick.road.id, s: Math.round(pick.hit.s * 10) / 10, length: 0, offset };
      this.mutate((n) => n.props.push(prop));
      this.selectProp(prop.id);
      return;
    }
    if (this.tool === 'erase') {
      const g = this.groundHit(0);
      if (!g) return;
      const pr = this.pickProp(g);
      if (pr) {
        this.deleteProp(pr.id);
        return;
      }
      const pick = this.pickRoad(g);
      if (pick) this.deleteRoad(pick.road.id);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.fly.rmb) {
      this.fly.look(dx, dy);
      this.fly.apply();
      return;
    }
    this.setRay(e);
    if (this.drag) {
      const road = this.getRoad(this.drag.roadId);
      if (!road) return;
      const pt = road.points[this.drag.idx];
      const g = this.groundHit(pt.y);
      if (!g) return;
      const p = this.snap(g);
      pt.x = p.x;
      pt.z = p.z;
      this.rebuild();
      return;
    }
    if (this.tool === 'draw' && this.draft.length) {
      const g = this.groundHit(0);
      this.draftHover = g ? this.snap(g) : null;
      this.updateDraftLine();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 2) {
      this.fly.rmb = false;
      return;
    }
    if (this.drag) {
      const before = this.drag.before;
      if (before !== JSON.stringify(this.net)) {
        this.undoStack.push(before);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
        this.redoStack = [];
      }
      this.drag = null;
      this.rebuild();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const k = e.key.toLowerCase();
    if (typing && !(e.ctrlKey || e.metaKey)) return;
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k)) {
      this.fly.keys.add(k);
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const toolByKey: Record<string, Tool> = { '1': 'select', '2': 'draw', '3': 'prop', '4': 'erase' };
    if (toolByKey[e.key]) this.setTool(toolByKey[e.key]);
    else if (k === 'enter' && this.tool === 'draw') this.finishDraw();
    else if (k === 'escape') {
      if (this.draft.length) this.cancelDraw();
      else if (this.selPoint !== null) this.selPoint = null;
      else this.selectRoad(null);
      this.onChange();
    } else if (k === 'delete' || k === 'backspace') {
      if (this.selProp || this.selRoad) {
        e.preventDefault();
        this.deleteSelection();
      }
    } else if (k === 'f') this.frameSelection();
    else if (k === 'g') this.setSnap(!this.snapOn);
    else if (k === 'pageup' || k === 'pagedown') {
      if (this.selRoad && this.selPoint !== null) {
        e.preventDefault();
        const r = this.getRoad(this.selRoad);
        const y = (r?.points[this.selPoint]?.y ?? 0) + (k === 'pageup' ? 0.25 : -0.25);
        this.setPointHeight(this.selRoad, this.selPoint, Math.round(y * 100) / 100);
      }
    }
  }

  setSnap(on: boolean): void {
    this.snapOn = on;
    this.onChange();
  }

  setTunnelVisible(v: boolean): void {
    this.view.setTunnelVisible(v);
  }

  // ---------------------------------------------------------------- overlay / gizmos
  private updateOverlay(): void {
    for (const h of this.handles) {
      this.overlay.remove(h);
      h.geometry.dispose();
    }
    this.handles = [];
    if (this.selLine) {
      this.overlay.remove(this.selLine);
      this.selLine.geometry.dispose();
      this.selLine = null;
    }
    if (this.propMarker) {
      this.overlay.remove(this.propMarker);
      this.propMarker.geometry.dispose();
      this.propMarker = null;
    }
    const road = this.getRoad(this.selRoad);
    if (road) {
      const S = this.sampledCache.get(road.id);
      if (S && S.pts.length > 1) {
        const pts = S.pts.map((p) => new THREE.Vector3(p.x, p.y + 0.35, p.z));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        this.selLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x33e0ff, depthTest: false, transparent: true }));
        this.selLine.renderOrder = 10;
        this.overlay.add(this.selLine);
      }
      road.points.forEach((p, idx) => {
        const selected = idx === this.selPoint;
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(1, 12, 8),
          new THREE.MeshBasicMaterial({ color: selected ? 0xffc02e : 0xffffff, depthTest: false, transparent: true }),
        );
        m.position.set(p.x, p.y + 0.4, p.z);
        m.userData.idx = idx;
        m.renderOrder = 11;
        this.overlay.add(m);
        this.handles.push(m);
      });
    }
    const prop = this.getProp(this.selProp);
    if (prop) {
      const q = this.propPos.get(prop.id);
      if (q) {
        this.propMarker = new THREE.Mesh(
          new THREE.RingGeometry(1.2, 1.6, 32).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0xffc02e, side: THREE.DoubleSide, depthTest: false, transparent: true }),
        );
        this.propMarker.position.set(q.x, q.y + 0.1, q.z);
        this.propMarker.renderOrder = 12;
        this.overlay.add(this.propMarker);
      }
    }
    this.updateDraftLine();
  }

  private updateDraftLine(): void {
    if (this.draftLine) {
      this.overlay.remove(this.draftLine);
      this.draftLine.geometry.dispose();
      this.draftLine = null;
    }
    const pts = this.draft.slice();
    if (this.draftHover) pts.push(this.draftHover);
    if (pts.length < 1) return;
    const sampled = pts.length >= 2 ? sampleRoad(makeRoad(this.drawPreset, pts)) : null;
    const pos = (sampled ? sampled.pts : pts).map((p) => new THREE.Vector3(p.x, p.y + 0.3, p.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pos);
    this.draftLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7dff5a, depthTest: false, transparent: true }));
    this.draftLine.renderOrder = 13;
    this.overlay.add(this.draftLine);
    for (const p of this.draft) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7dff5a, depthTest: false }));
      m.position.set(p.x, p.y + 0.4, p.z);
      m.renderOrder = 14;
      m.userData.draft = true;
      this.overlay.add(m);
      this.handles.push(m);
    }
  }

  private updateHandleScale(): void {
    for (const h of this.handles) {
      if (h.userData.draft) continue;
      const d = this.camera.position.distanceTo(h.position);
      h.scale.setScalar(Math.max(0.6, d * 0.012));
    }
  }

  // ---------------------------------------------------------------- camera framing
  frameSelection(): void {
    const road = this.getRoad(this.selRoad);
    if (road) {
      const S = this.sampledCache.get(road.id);
      if (S) {
        const mid = at(S, S.length / 2).p;
        this.fly.lookAt(new THREE.Vector3(mid.x, mid.y, mid.z), Math.max(60, S.length * 0.9));
        return;
      }
    }
    const prop = this.propPos.get(this.selProp ?? '');
    if (prop) {
      this.fly.lookAt(new THREE.Vector3(prop.x, prop.y, prop.z), 40);
      return;
    }
    this.frameAll();
  }

  frameAll(): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const S of this.sampledCache.values()) {
      for (const p of S.pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
    }
    if (!isFinite(minX)) {
      this.fly.lookAt(new THREE.Vector3(0, 0, 0), 300);
      return;
    }
    const c = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const size = Math.max(maxX - minX, maxZ - minZ);
    this.fly.lookAt(c, size * 0.9);
  }

  // ---------------------------------------------------------------- stats for the UI
  summary(): { roads: number; km: number; props: number; tris: number; junctions: number; crossings: number; buildMs: number } {
    let len = 0;
    for (const S of this.sampledCache.values()) len += S.length;
    return {
      roads: this.net.roads.length,
      km: len / 1000,
      props: this.net.props.length,
      tris: this.mesh?.stats.triangles ?? 0,
      junctions: this.mesh?.junctions.length ?? 0,
      crossings: this.mesh?.crossings.length ?? 0,
      buildMs: this.stats.buildMs,
    };
  }

  describeLanes(road: Road): string {
    return laneBands(road.lanes)
      .map(({ lane }) => `${lane.kind}${LANE_RAISE[lane.kind] ? '↑' : ''}`)
      .join(' · ');
  }
}

