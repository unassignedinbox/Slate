/**
 * Car crash test bed.
 *
 *  - the body is ONE merged BufferGeometry (hood + cabin + fenders in a single
 *    draw call) so the VAT dent field can be validated exactly the way it will
 *    be used on a real vehicle asset: nothing is split per panel, nothing is
 *    re-uploaded, and duplicated seam vertices stay welded because the
 *    displacement is a pure function of object-space position;
 *  - the headlights / indicator lenses are separate brittle glass bodies with
 *    PRE-BAKED fracture patterns, so a bumper tap costs 0 ms of solver time;
 *  - steel dents, glass shatters, in the same impact.
 */
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshDepthMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, RGBADepthPacking,
  Scene, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box as boxPiece, type Piece } from '../core/convex';
import { MATERIALS, type MaterialDef } from '../fracture/materials';
import { fracture, type Fragment, type Impact } from '../fracture/fracture';
import { bakePanel, PANEL_PRESETS, type DentField } from '../deform/panel';
import { DentSystem } from '../deform/dent';
import type { Physics, Handle } from '../physics/jolt';

export interface CarCallbacks {
  spawnFragments: (
    frags: Fragment[], origin: Vector3, quat: Quaternion, mat: MaterialDef,
    imp: Impact, energy: number, baseVel: Vector3) => void;
  dust: (at: Vector3, mat: MaterialDef, energy: number) => void;
  sound: (kind: string, energy: number, shatter: boolean) => void;
}

const LENS: MaterialDef = {
  ...MATERIALS.glass,
  id: 'lens', label: 'Headlight lens',
  minFragment: 3e-8,
  surface: { amp: 0.0009, freq: 40, octaves: 3, subdiv: 1 },
};

/** Baked panels are expensive; cache per steel gauge. */
const fieldCache = new Map<number, { fields: DentField[]; ms: number }>();

export function bakeFields(gaugeMm: number) {
  const key = Math.round(gaugeMm * 100);
  const hit = fieldCache.get(key);
  if (hit) return { ...hit, cached: true };
  const g = gaugeMm / 1000;
  const a = bakePanel(PANEL_PRESETS.blunt(g));
  const b = bakePanel(PANEL_PRESETS.edge(g));
  const rec = { fields: [a, b], ms: a.ms + b.ms };
  fieldCache.set(key, rec);
  return { ...rec, cached: false };
}

/** Same bake, off the main thread (falls back to the sync path). */
export function bakeFieldsAsync(gaugeMm: number): Promise<{ fields: DentField[]; ms: number; cached: boolean }> {
  const key = Math.round(gaugeMm * 100);
  const hit = fieldCache.get(key);
  if (hit) return Promise.resolve({ ...hit, cached: true });
  return new Promise(resolve => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../deform/bake.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(bakeFields(gaugeMm)); return;
    }
    const t0 = performance.now();
    worker.onmessage = (e: MessageEvent<DentField[]>) => {
      const rec = { fields: e.data, ms: performance.now() - t0 };
      fieldCache.set(key, rec);
      worker.terminate();
      resolve({ ...rec, cached: false });
    };
    worker.onerror = () => { worker.terminate(); resolve(bakeFields(gaugeMm)); };
    worker.postMessage({ gauge: gaugeMm });
  });
}

interface Lens { mesh: Mesh; piece: Piece; offset: Vector3; broken: boolean; baked: Fragment[][] }

export class CarScene {
  group = new Group();
  body!: Mesh;
  lenses: Lens[] = [];
  dents!: DentSystem;
  fields: DentField[] = [];
  handle: Handle | null = null;
  bakeMs = 0;
  vatKB = 0;
  lensBakeMs = 0;

  constructor(
    private scene: Scene,
    private physics: Physics,
    private cb: CarCallbacks,
    private position = new Vector3(0, 0.62, 0),
  ) {}

  async build(gaugeMm: number) {
    const { fields, ms, cached } = await bakeFieldsAsync(gaugeMm);
    this.fields = fields;
    this.bakeMs = cached ? 0 : ms;
    this.dents = new DentSystem(fields);
    this.vatKB = (fields[0].grid * fields[0].grid * fields[0].frames * fields.length * 4 * 2) / 1024;

    /* ---------------- single-geometry body ---------------- */
    const parts: BufferGeometry[] = [];
    const lower = new BoxGeometry(4.3, 0.78, 1.86, 52, 12, 24);
    lower.translate(0, 0.39, 0);
    parts.push(lower);
    const cabin = new BoxGeometry(2.25, 0.66, 1.68, 28, 10, 22);
    cabin.translate(-0.2, 1.10, 0);
    parts.push(cabin);
    const hood = new BoxGeometry(1.5, 0.12, 1.74, 20, 4, 22);
    hood.translate(1.35, 0.82, 0);
    parts.push(hood);
    const boot = new BoxGeometry(1.0, 0.14, 1.74, 14, 4, 22);
    boot.translate(-1.6, 0.83, 0);
    parts.push(boot);
    const merged = mergeGeometries(parts, false)!;
    merged.computeVertexNormals();
    for (const p of parts) p.dispose();

    const paint = new MeshPhysicalMaterial({
      color: 0x9c1b1b, metalness: 0.92, roughness: 0.26,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3,
    });
    this.dents.attach(paint);

    this.body = new Mesh(merged, paint);
    // the shadow pass uses its own material, so it needs the same VAT patch or
    // the car would cast an undented shadow
    const depthMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.dents.attach(depthMat);
    this.body.customDepthMaterial = depthMat;
    this.body.castShadow = this.body.receiveShadow = true;
    this.group.add(this.body);

    /* ---------------- glass + trim ---------------- */
    const glassMat = new MeshPhysicalMaterial({
      color: 0xdff0ff, roughness: 0.05, metalness: 0, transmission: 0.92,
      thickness: 0.02, ior: 1.5, transparent: true, envMapIntensity: 1.6,
    });
    const lensGeo = new BoxGeometry(0.16, 0.2, 0.44);
    const lensPiece = boxPiece(0.16, 0.2, 0.44);
    for (const z of [-0.62, 0.62]) {
      for (const x of [2.16, -2.16]) {
        const mesh = new Mesh(lensGeo.clone(), glassMat.clone());
        const offset = new Vector3(x, 0.62, z);
        mesh.position.copy(offset);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.lenses.push({ mesh, piece: lensPiece.clone(), offset, broken: false, baked: [] });
      }
    }
    // pre-bake the lens shatter patterns: hitting a headlight must be free
    const t0 = performance.now();
    const proto = this.lenses[0];
    for (let i = 0; i < 3; i++) {
      const imp: Impact = {
        point: new Vector3(0.08, (i - 1) * 0.05, (i - 1) * 0.12),
        dir: new Vector3(-1, 0, 0), energy: 60, radius: 0.012,
      };
      proto.baked.push(fracture(proto.piece, LENS, imp, 90, 4000 + i).fragments);
    }
    for (const l of this.lenses) l.baked = proto.baked;
    this.lensBakeMs = performance.now() - t0;

    /* ---------------- wheels + glasshouse ---------------- */
    const rubber = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.95 });
    const wheel = new CylinderGeometry(0.34, 0.34, 0.24, 22);
    wheel.rotateX(Math.PI / 2);
    for (const x of [1.42, -1.42]) {
      for (const z of [-0.88, 0.88]) {
        const w = new Mesh(wheel, rubber);
        w.position.set(x, 0.0, z);
        w.castShadow = true;
        this.group.add(w);
      }
    }
    const windowMat = new MeshPhysicalMaterial({
      color: 0x0c1418, roughness: 0.08, metalness: 0.1, transmission: 0.7,
      thickness: 0.01, transparent: true,
    });
    const ws = new Mesh(new BoxGeometry(0.06, 0.5, 1.6), windowMat);
    ws.position.set(0.95, 1.12, 0);
    ws.rotation.z = -0.35;
    this.group.add(ws);

    this.group.position.copy(this.position);
    this.scene.add(this.group);

    // one convex body for the whole car; the dent field is cosmetic + queried
    // on the CPU when something needs the deformed surface
    const chassis = boxPiece(4.3, 1.5, 1.86);
    this.handle = this.physics.addStaticConvex(chassis, new Vector3(), this.position.clone().add(new Vector3(0, 0.36, 0)), 0.9);
  }

  /** World-space raycast targets. */
  get pickables(): Object3D[] {
    return [this.body, ...this.lenses.filter(l => !l.broken).map(l => l.mesh)];
  }

  /** Steel panel hit -> plastic dent from the baked VAT. */
  dentAt(pointWorld: Vector3, normalWorld: Vector3, energy: number) {
    const inv = this.body.matrixWorld.clone().invert();
    const p = pointWorld.clone().applyMatrix4(inv);
    const n = normalWorld.clone().transformDirection(inv).normalize();
    // a glancing hit creases (edge archetype), a square hit dishes it (blunt)
    const arch = Math.random() < 0.35 ? 1 : 0;
    const d = this.dents.hit(p, n, energy, 0.85, arch);
    this.cb.sound('metal', energy, false);
    return d;
  }

  /** Lens hit -> instantiate a pre-baked shatter (0 ms solve). */
  breakLens(mesh: Mesh, dirWorld: Vector3, energy: number) {
    const lens = this.lenses.find(l => l.mesh === mesh);
    if (!lens || lens.broken) return false;
    lens.broken = true;
    const frags = lens.baked[(Math.random() * lens.baked.length) | 0]
      .map(f => ({ ...f, piece: f.piece.clone(), centroid: f.centroid.clone() }));
    const origin = mesh.getWorldPosition(new Vector3());
    const imp: Impact = { point: new Vector3(), dir: new Vector3(-1, 0, 0), energy, radius: 0.012 };
    this.cb.spawnFragments(frags, origin, new Quaternion(), LENS, imp, Math.min(energy, 220), new Vector3());
    this.cb.dust(origin, LENS, Math.min(energy, 160));
    this.cb.sound('glass', energy, true);
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as MeshPhysicalMaterial).dispose();
    // the surrounding sheet metal takes a hit too
    this.dentAt(origin.clone().add(new Vector3(-0.12, 0, 0)), new Vector3(1, 0, 0), energy * 0.5);
    return true;
  }

  get dentCount() { return this.dents.dents.length; }

  get maxDentDepth() {
    let d = 0;
    for (const dent of this.dents.dents) {
      const f = this.fields[dent.archetype];
      d = Math.max(d, f.depths[Math.min(f.depths.length - 1, Math.round(dent.severity))]);
    }
    return d;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mm = m.material as MeshStandardMaterial | MeshStandardMaterial[];
      if (Array.isArray(mm)) mm.forEach(x => x.dispose()); else mm?.dispose();
    });
    if (this.handle) this.physics.remove(this.handle);
    this.handle = null;
  }
}
