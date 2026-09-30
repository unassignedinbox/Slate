/**
 * App shell: camera, input, GPU mesh cache, HUD.
 */

import {
  V3, add, clamp, len, mul, norm, sub, v3, m4Compose, quat, m4Invert, m4TransformPoint,
} from './core/math';
import { MeshData } from './geom/convex';
import { Renderer, DrawItem } from './render/renderer';
import { GpuMesh, makeMesh, freeMesh } from './render/gl';
import { Batch, BatchInput } from './render/batch';
import { SCENES, SceneDef, Scene, PaneScene, StructureScene, SolidScene, makeScene, RenderPiece } from './app/scenes';

function fatal(err: unknown): void {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;inset:24px;z-index:99;overflow:auto;padding:18px;border-radius:10px;' +
    'background:#14171b;border:1px solid #3a3f47;color:#ffb3b3;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap';
  box.textContent = 'Fracture demo failed to start:\n\n' + (err instanceof Error ? (err.stack ?? err.message) : String(err));
  document.body.appendChild(box);
  console.error(err);
}
window.addEventListener('error', (e) => fatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const gl = renderer.gl;

// ------------------------------------------------------------- mesh cache

class MeshCache {
  private map = new Map<MeshData, { gpu: GpuMesh; used: number }>();
  frame = 0;
  get(md: MeshData): GpuMesh {
    let e = this.map.get(md);
    if (!e) {
      e = { gpu: makeMesh(gl, md.pos, md.nrm, md.attr), used: this.frame };
      this.map.set(md, e);
    }
    e.used = this.frame;
    return e.gpu;
  }
  sweep(): void {
    for (const [k, e] of this.map) {
      if (this.frame - e.used > 120) { freeMesh(gl, e.gpu); this.map.delete(k); }
    }
  }
  clear(): void {
    for (const [, e] of this.map) freeMesh(gl, e.gpu);
    this.map.clear();
  }
}
const cache = new MeshCache();
const glassBatch = new Batch(gl);

// ------------------------------------------------------------------ camera

const IDENTITY = m4Compose(v3(0, 0, 0), quat());

const cam = {
  yaw: 0.0, pitch: 0.24, dist: 4.2, target: v3(0, 1, 0), fov: 0.85,
  shake: 0, autoOrbit: false,
};

function camPos(): V3 {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const d = cam.dist;
  const p = v3(
    cam.target.x + Math.sin(cam.yaw) * cp * d,
    cam.target.y + sp * d,
    cam.target.z + Math.cos(cam.yaw) * cp * d,
  );
  if (cam.shake > 0) {
    const s = cam.shake;
    p.x += (Math.random() - 0.5) * s; p.y += (Math.random() - 0.5) * s; p.z += (Math.random() - 0.5) * s;
  }
  return p;
}

// -------------------------------------------------------------------- state

let sceneDef: SceneDef = SCENES[0];
let scene: Scene = makeScene(sceneDef);
let maskTex: WebGLTexture | null = null;

let energy = 26;
let crackScale = 0;
let physScale = 1;

interface Projectile { pos: V3; vel: V3; target: V3; t: number; ttl: number; dir: V3; }
const projectiles: Projectile[] = [];
let ballMesh: MeshData | null = null;

function sphereMesh(r: number, seg = 12): MeshData {
  const pos: number[] = [], nrm: number[] = [], attr: number[] = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg * 2; i++) {
      const p = (a: number, b: number): V3 => {
        const th = (a / (seg * 2)) * Math.PI * 2, ph = (b / seg) * Math.PI;
        return v3(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r);
      };
      const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
      for (const t of [[a, b, c], [a, c, d]]) {
        for (const q of t) {
          pos.push(q.x, q.y, q.z);
          const n = norm(q); nrm.push(n.x, n.y, n.z);
          attr.push(0, 0, 0);
        }
      }
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), attr: new Float32Array(attr), count: pos.length / 3 };
}

function setScene(def: SceneDef): void {
  sceneDef = def;
  scene.dispose();
  cache.clear();
  if (maskTex) { gl.deleteTexture(maskTex); maskTex = null; }
  scene = makeScene(def);
  cam.target = scene.cameraTarget;
  cam.dist = scene.cameraDist;
  cam.yaw = def.kind === 'pane' ? 0.12 : 0.6;
  cam.pitch = def.kind === 'pane' ? 0.08 : 0.22;
  projectiles.length = 0;
  energyEl.value = String(energyToSlider(def.energy));
  syncUI();
  document.getElementById('blurb')!.textContent = def.blurb;
  for (const el of Array.from(document.querySelectorAll('#scenes button'))) {
    el.classList.toggle('on', (el as HTMLElement).dataset.id === def.id);
  }
  toast(def.label);
}

function ensureMaskTex(ps: PaneScene): WebGLTexture {
  if (!maskTex) {
    maskTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ps.net.nx, ps.net.ny, 0, gl.RED, gl.UNSIGNED_BYTE, ps.regions.mask);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ps.regions.maskDirty = false;
  } else if (ps.regions.maskDirty) {
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ps.net.nx, ps.net.ny, gl.RED, gl.UNSIGNED_BYTE, ps.regions.mask);
    ps.regions.maskDirty = false;
  }
  return maskTex;
}

// --------------------------------------------------------------------- input

let dragging = false, dragMoved = 0, lastX = 0, lastY = 0, downButton = 0;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY; downButton = e.button;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (dragMoved > 4) {
    cam.yaw -= dx * 0.006;
    cam.pitch = clamp(cam.pitch + dy * 0.005, -0.35, 1.25);
    cam.autoOrbit = false;
    document.getElementById('auto')!.classList.remove('on');
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (dragging && dragMoved < 5 && downButton === 0) shootAt(e.clientX, e.clientY);
  dragging = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0011), 0.8, 30);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function rayFromScreen(sx: number, sy: number): { ro: V3; rd: V3 } {
  const rect = canvas.getBoundingClientRect();
  const x = ((sx - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((sy - rect.top) / rect.height) * 2;
  const inv = m4Invert(renderer.viewProj);
  const near = m4TransformPoint(inv, v3(x, y, -1));
  const far = m4TransformPoint(inv, v3(x, y, 1));
  return { ro: near, rd: norm(sub(far, near)) };
}

function shootAt(sx: number, sy: number): void {
  const { ro, rd } = rayFromScreen(sx, sy);
  const hit = scene.pick(ro, rd);
  if (!hit) { toast('missed'); return; }
  if (!ballMesh) ballMesh = sphereMesh(0.035);
  const start = add(renderer.camPos, mul(rd, 0.35));
  const dist = len(sub(hit.point, start));
  const speed = 34;
  projectiles.push({
    pos: start, vel: mul(rd, speed), target: hit.point,
    t: 0, ttl: dist / speed, dir: rd,
  });
}

function applyHit(p: Projectile): void {
  scene.hit(p.target, p.dir, energy);
  cam.shake = clamp(energy * 0.0016, 0.01, 0.09);
}

// ------------------------------------------------------------------------ UI

const chips = document.getElementById('scenes')!;
for (const s of SCENES) {
  const b = document.createElement('button');
  b.textContent = s.label;
  b.dataset.id = s.id;
  b.onclick = () => setScene(s);
  chips.appendChild(b);
}

const energyEl = document.getElementById('energy') as HTMLInputElement;
const crackEl = document.getElementById('crackScale') as HTMLInputElement;
const physEl = document.getElementById('physScale') as HTMLInputElement;
const energyOut = document.getElementById('energyOut')!;
const crackOut = document.getElementById('crackOut')!;
const physOut = document.getElementById('physOut')!;

/** Log-scale energy slider: 1 J .. 50 kJ. */
const ENERGY_MIN = 1, ENERGY_MAX = 50000;
const sliderToEnergy = (t: number) =>
  Math.round(ENERGY_MIN * Math.pow(ENERGY_MAX / ENERGY_MIN, t / 1000));
const energyToSlider = (e: number) =>
  Math.round((Math.log(e / ENERGY_MIN) / Math.log(ENERGY_MAX / ENERGY_MIN)) * 1000);

function energyLabel(e: number): string {
  const ref =
    e < 20 ? 'thrown pebble' :
    e < 70 ? 'thrown stone' :
    e < 250 ? 'hammer blow' :
    e < 900 ? 'sledgehammer' :
    e < 2500 ? 'baseball bat, hard' :
    e < 6000 ? 'rifle round' :
    e < 20000 ? 'car at 20 km/h' : 'grenade, close';
  const v = e >= 1000 ? (e / 1000).toFixed(1) + ' kJ' : e + ' J';
  return `${v} · ${ref}`;
}

function syncUI(): void {
  energy = sliderToEnergy(+energyEl.value);
  // log slider: 1e-5 .. 1 (1 = real time, i.e. over in a frame)
  const t = +crackEl.value / 100;
  crackScale = Math.pow(10, -5 + 5 * t);
  physScale = +physEl.value / 100;
  energyOut.textContent = energyLabel(energy);
  crackOut.textContent = crackScale >= 0.5 ? 'realtime'
    : `1 : ${Math.round(1 / crackScale).toLocaleString()}`;
  physOut.textContent = physScale >= 0.995 ? 'realtime' : `${physScale.toFixed(2)}×`;
}
energyEl.oninput = crackEl.oninput = physEl.oninput = syncUI;
syncUI();

document.getElementById('reset')!.onclick = () => setScene(sceneDef);
const autoBtn = document.getElementById('auto')!;
autoBtn.onclick = () => { cam.autoOrbit = !cam.autoOrbit; autoBtn.classList.toggle('on', cam.autoOrbit); };

let toastTimer = 0;
function toast(msg: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1600);
}

window.addEventListener('keydown', (e) => {
  const i = SCENES.findIndex((s) => s.id === sceneDef.id);
  if (e.key === 'r' || e.key === 'R') setScene(sceneDef);
  if (e.key === ' ') { e.preventDefault(); shootAt(window.innerWidth * 0.58, window.innerHeight * 0.5); }
  if (e.key === 'ArrowRight') setScene(SCENES[(i + 1) % SCENES.length]);
  if (e.key === 'ArrowLeft') setScene(SCENES[(i + SCENES.length - 1) % SCENES.length]);
});

const statsEl = document.getElementById('stats')!;
function renderStats(extra: Record<string, string>): void {
  const rows: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    rows.push(`<div class="k">${k}</div><div class="v">${v}</div>`);
  }
  statsEl.innerHTML = rows.join('');
}

// ------------------------------------------------------------------- loop

setScene(SCENES[0]);

let firstLoad = true;
let demoTimer = 0;

let last = performance.now();
let fpsAcc = 0, fpsN = 0, statAcc = 0;

function frame(now: number): void {
  const dtWall = Math.min((now - last) / 1000, 0.05);
  last = now;
  cache.frame++;

  if (firstLoad) {
    demoTimer += dtWall;
    if (demoTimer > 1.1) {
      firstLoad = false;
      shootAt(window.innerWidth * 0.56, window.innerHeight * 0.46);
    }
  }
  if (cam.autoOrbit) cam.yaw += dtWall * 0.25;
  cam.shake *= Math.exp(-dtWall * 9);

  // projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += dtWall;
    p.pos = add(p.pos, mul(p.vel, dtWall));
    if (p.t >= p.ttl) { applyHit(p); projectiles.splice(i, 1); }
  }

  scene.update(dtWall, crackScale, physScale);

  renderer.resize();
  renderer.setCamera(camPos(), cam.target, cam.fov);

  const pieces: RenderPiece[] = [];
  scene.collect(pieces);

  const opaque: DrawItem[] = [];
  const glassItems: DrawItem[] = [];
  const batchIn: BatchInput[] = [];
  let batchProto: RenderPiece | null = null;
  for (const p of pieces) {
    if (p.batch) {
      batchIn.push({ mesh: p.mesh, model: p.model, seed: p.seed });
      if (!batchProto) batchProto = p;
      continue;
    }
    const item: DrawItem = {
      mesh: cache.get(p.mesh), model: p.model, style: p.style, color: p.color,
      spec: p.spec, rough: p.rough, seed: p.seed, strain: p.strain, grain: p.grain,
      alpha: p.alpha, emissive: p.style === 5 ? 2.6 : 1,
    };
    if (p.mask && scene instanceof PaneScene) {
      item.mask = ensureMaskTex(scene);
      item.maskSize = [scene.W, scene.H];
    }
    (p.glass ? glassItems : opaque).push(item);
  }
  // one draw call for all the glass debris
  if (batchProto && batchIn.length) {
    const g = glassBatch.build(batchIn);
    if (g) {
      (batchProto.glass ? glassItems : opaque).push({
        mesh: g, model: IDENTITY, style: batchProto.style, color: batchProto.color,
        spec: batchProto.spec, rough: batchProto.rough, seed: -1, strain: 0,
        grain: batchProto.grain, alpha: 1,
      });
    }
  }

  // projectiles
  if (ballMesh) {
    for (const p of projectiles) {
      opaque.push({
        mesh: cache.get(ballMesh), model: m4Compose(p.pos, quat()), style: 2,
        color: [0.09, 0.09, 0.1], spec: 0.9, rough: 0.2, seed: 3, strain: 0,
        grain: v3(0, 1, 0), alpha: 1,
      });
    }
  }

  renderer.render(opaque, glassItems);
  if (cache.frame % 90 === 0) cache.sweep();

  fpsAcc += dtWall; fpsN++; statAcc += dtWall;
  if (statAcc > 0.25) {
    statAcc = 0;
    document.getElementById('fps')!.textContent =
      `${(fpsN / fpsAcc).toFixed(0)} fps · ${opaque.length + glassItems.length} draws`;
    fpsAcc = 0; fpsN = 0;
    const base: Record<string, string> = {};
    if (scene instanceof PaneScene) Object.assign(base, scene.stats());
    else if (scene instanceof StructureScene) Object.assign(base, scene.stats());
    else if (scene instanceof SolidScene) {
      Object.assign(base, scene.lastStats, {
        'rigid bodies': String(scene.world.bodies.length),
      });
    }
    renderStats(base);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame((t) => { try { frame(t); } catch (e) { fatal(e); } });
