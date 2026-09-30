import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { buildGeometry, Piece, type SurfaceOpts } from './core/convex';
import { rng } from './core/math';
import { MATERIALS, type MaterialDef } from './fracture/materials';
import { fracture, surfaceNoise, type Fragment, type Impact } from './fracture/fracture';
import { makeTarget, type Target } from './scene/targets';
import { ensureAudio, playImpact } from './scene/audio';

/* ------------------------------------------------------------------ */
/* renderer / scene                                                     */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
scene.fog = new THREE.Fog(0x0b0d10, 14, 42);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
camera.position.set(2.6, 1.8, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;

const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
key.position.set(4, 7, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const sc = key.shadow.camera as THREE.OrthographicCamera;
sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.far = 25;
key.shadow.bias = -0.0008;
scene.add(key, new THREE.HemisphereLight(0x9fc6ff, 0x20242b, 0.55));
const rim = new THREE.DirectionalLight(0x86b8ff, 1.1); rim.position.set(-5, 2.5, -4); scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(24, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.85, metalness: 0 }));
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(24, 48, 0x243040, 0x1a222c));

/* ------------------------------------------------------------------ */
/* physics                                                              */
/* ------------------------------------------------------------------ */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
(world.solver as CANNON.GSSolver).iterations = 8;
world.allowSleep = true;
const defaultMat = new CANNON.Material('d');
world.defaultContactMaterial.friction = 0.6;
world.defaultContactMaterial.restitution = 0.1;
const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: defaultMat });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

/* ------------------------------------------------------------------ */
/* state                                                                */
/* ------------------------------------------------------------------ */
interface Body3 { mesh: THREE.Object3D; body: CANNON.Body; mat: MaterialDef; vol: number; fractured: boolean; born: number }
let target: Target;
let targetMesh: THREE.Mesh | null = null;
let targetBody: CANNON.Body | null = null;
let intact = true;
const dynamics: Body3[] = [];
const props: THREE.Object3D[] = [];
const constraints: CANNON.Constraint[] = [];
let damageTex: THREE.CanvasTexture | null = null;
let damageCanvas: HTMLCanvasElement | null = null;
let damageMesh: THREE.Mesh | null = null;
let damageHits = 0;
let baked: { impact: Impact; frags: Fragment[] }[] = [];
let bakeMs = 0;
const stats = { frags: 0, bodies: 0, ms: 0, area: 0, fps: 0 };

const ui = {
  mat: document.getElementById('mat') as HTMLSelectElement,
  e: document.getElementById('e') as HTMLInputElement,
  m: document.getElementById('m') as HTMLInputElement,
  b: document.getElementById('b') as HTMLInputElement,
  r: document.getElementById('r') as HTMLInputElement,
  secondary: document.getElementById('secondary') as HTMLInputElement,
  rebar: document.getElementById('rebar') as HTMLInputElement,
  dust: document.getElementById('dust') as HTMLInputElement,
  bake: document.getElementById('bake') as HTMLInputElement,
  slowmo: document.getElementById('slowmo') as HTMLInputElement,
  statsEl: document.getElementById('stats')!,
  hint: document.getElementById('hint')!,
};
for (const k of Object.keys(MATERIALS)) {
  const o = document.createElement('option'); o.value = k; o.textContent = MATERIALS[k].label; ui.mat.appendChild(o);
}

/* ------------------------------------------------------------------ */
/* materials                                                            */
/* ------------------------------------------------------------------ */
function makeSurfaceMats(m: MaterialDef, shard = false): THREE.Material[] {
  if (m.transmission && shard) {
    // hundreds of transmissive meshes would each need a transmission pass;
    // shards use a cheap refractive-looking blend instead (visually identical
    // at shard scale, ~40x cheaper)
    const base = {
      color: m.color, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.34,
      side: THREE.DoubleSide, envMapIntensity: 3.2, depthWrite: false as const,
    };
    const a = new THREE.MeshPhysicalMaterial({ ...base, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.35 });
    const b = new THREE.MeshPhysicalMaterial({ ...base, color: m.interiorColor, opacity: 0.42, roughness: 0.3, clearcoat: 0.8 });
    matPool.push(a, b); return [a, b];
  }
  const ext = m.transmission
    ? new THREE.MeshPhysicalMaterial({
      color: m.color, roughness: m.roughness, metalness: 0, transmission: m.transmission,
      thickness: 0.02, ior: m.ior, transparent: true, opacity: 1, side: THREE.DoubleSide,
      envMapIntensity: 1.6, clearcoat: 0.6,
    })
    : new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness });
  const inn = m.transmission
    ? new THREE.MeshPhysicalMaterial({
      color: m.interiorColor, roughness: 0.28, metalness: 0, transmission: 0.72, thickness: 0.01,
      ior: m.ior, transparent: true, side: THREE.DoubleSide, envMapIntensity: 2.2, clearcoat: 1,
    })
    : new THREE.MeshStandardMaterial({
      color: m.interiorColor, roughness: Math.min(1, m.roughness + 0.12), metalness: m.metalness,
      flatShading: m.mode !== 'ductile',
    });
  matPool.push(ext, inn);
  return [ext, inn];
}

function surfOpts(m: MaterialDef): SurfaceOpts {
  const k = +ui.r.value / 100;
  return {
    amp: m.surface.amp * k, freq: m.surface.freq, octaves: m.surface.octaves,
    subdiv: k <= 0 ? 0 : m.surface.subdiv, stretch: m.surface.stretch, noise: surfaceNoise(m),
  };
}

/* ------------------------------------------------------------------ */
/* build / reset                                                        */
/* ------------------------------------------------------------------ */
function clearAll() {
  for (const c of constraints) world.removeConstraint(c);
  constraints.length = 0;
  for (const d of dynamics) { scene.remove(d.mesh); world.removeBody(d.body); disposeObj(d.mesh, true); }
  dynamics.length = 0;
  for (const p of props) { scene.remove(p); disposeObj(p); }
  props.length = 0;
  for (const m of matPool) m.dispose();
  matPool.length = 0;
  if (targetMesh) { scene.remove(targetMesh); disposeObj(targetMesh); targetMesh = null; }
  if (targetBody) { world.removeBody(targetBody); targetBody = null; }
  if (damageMesh) { scene.remove(damageMesh); disposeObj(damageMesh); damageMesh = null; }
  damageTex = null; damageCanvas = null; damageHits = 0;
  for (const s of staticBodies) world.removeBody(s);
  staticBodies.length = 0;
  baked = []; bakeMs = 0;
}
const staticBodies: CANNON.Body[] = [];

const matPool: THREE.Material[] = [];
function disposeObj(o: THREE.Object3D, geometryOnly = false) {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (geometryOnly) return;
    const mm = m.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mm)) mm.forEach(x => { if (!matPool.includes(x)) x.dispose(); });
    else if (mm && !matPool.includes(mm)) mm.dispose();
  });
}

function cannonConvex(p: Piece, center: THREE.Vector3) {
  return new CANNON.ConvexPolyhedron({
    vertices: p.verts.map(v => new CANNON.Vec3(v.x - center.x, v.y - center.y, v.z - center.z)),
    faces: p.faces.map(f => f.idx.slice()),
  });
}

function reset() {
  clearAll();
  target = makeTarget(ui.mat.value);
  intact = true;
  ui.hint.innerHTML = target.hint + ' &nbsp;·&nbsp; click the object to hit it there';

  const m = target.mat;
  const mats = makeSurfaceMats(m);
  const geo = buildGeometry(target.piece, { ...surfOpts(m), subdiv: 0, amp: 0 });
  targetMesh = new THREE.Mesh(geo, mats);
  targetMesh.castShadow = targetMesh.receiveShadow = true;
  targetMesh.position.copy(target.position);
  scene.add(targetMesh);

  const vol = target.piece.volume();
  targetBody = new CANNON.Body({
    mass: target.static ? 0 : vol * m.density,
    shape: cannonConvex(target.piece, new THREE.Vector3()),
    material: defaultMat,
    position: new CANNON.Vec3(target.position.x, target.position.y, target.position.z),
  });
  world.addBody(targetBody);

  // supports
  for (const s of target.supports) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(...s.size),
      new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.7, metalness: 0.3 }));
    g.position.set(target.position.x + s.pos[0], target.position.y + s.pos[1], target.position.z + s.pos[2]);
    g.castShadow = g.receiveShadow = true;
    scene.add(g); props.push(g);
    const b = new CANNON.Body({
      mass: 0, material: defaultMat,
      shape: new CANNON.Box(new CANNON.Vec3(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2)),
      position: new CANNON.Vec3(g.position.x, g.position.y, g.position.z),
    });
    world.addBody(b); staticBodies.push(b);
  }

  if (m.transmission) setupDamageDecal();
  if (ui.bake.checked) prebake();
  updateStats();
}

/* ---- progressive damage decal (glass that cracks but holds) -------- */
function setupDamageDecal() {
  damageCanvas = document.createElement('canvas');
  damageCanvas.width = damageCanvas.height = 1024;
  damageTex = new THREE.CanvasTexture(damageCanvas);
  const { mn, mx } = target.piece.bounds();
  const g = new THREE.PlaneGeometry(mx.x - mn.x, mx.y - mn.y);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, alphaMap: damageTex, transparent: true, roughness: 0.25,
    depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
  });
  damageMesh = new THREE.Mesh(g, mat);
  damageMesh.position.copy(target.position).z += (mx.z - mn.z) / 2 + 0.001;
  scene.add(damageMesh);
}

/** Draw the same radial + ring crack topology the 3D solver would produce. */
function paintDamage(local: THREE.Vector3, energy: number) {
  if (!damageCanvas || !damageTex) return;
  const { mn, mx } = target.piece.bounds();
  const c = damageCanvas.getContext('2d')!;
  const S = damageCanvas.width;
  const px = ((local.x - mn.x) / (mx.x - mn.x)) * S;
  const py = (1 - (local.y - mn.y) / (mx.y - mn.y)) * S;
  const r = rng((px * 31 + py * 17) | 0);
  const scale = S / Math.max(mx.x - mn.x, mx.y - mn.y);
  const reach = Math.min(S, (0.12 + energy / 220) * scale);
  c.strokeStyle = '#fff'; c.lineCap = 'round';

  const arms = 7 + ((r() * 7) | 0);
  for (let i = 0; i < arms; i++) {
    let a = (i / arms) * Math.PI * 2 + r() * 0.5;
    let x = px, y = py, len = reach * (0.45 + r() * 0.9);
    c.beginPath(); c.moveTo(x, y);
    let travelled = 0;
    while (travelled < len) {
      const step = 8 + r() * 16;
      a += (r() - 0.5) * 0.35;            // crack wander
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      travelled += step;
      c.lineWidth = Math.max(0.4, 2.4 * (1 - travelled / len));
      c.lineTo(x, y);
    }
    c.stroke();
  }
  // concentric ring (Wallner) cracks
  const rings = 2 + ((r() * 3) | 0);
  for (let k = 1; k <= rings; k++) {
    const rr = reach * (0.22 + 0.8 * (k / rings));
    c.beginPath(); c.lineWidth = 1.3;
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const wob = rr * (1 + 0.14 * Math.sin(a * (3 + k) + k * 2.1) + (r() - 0.5) * 0.05);
      const x = px + Math.cos(a) * wob, y = py + Math.sin(a) * wob;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }
  // crushed contact zone
  const grd = c.createRadialGradient(px, py, 0, px, py, reach * 0.16);
  grd.addColorStop(0, 'rgba(255,255,255,.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grd; c.beginPath(); c.arc(px, py, reach * 0.16, 0, 7); c.fill();
  damageTex.needsUpdate = true;
  damageHits++;
}

/* ------------------------------------------------------------------ */
/* baking                                                               */
/* ------------------------------------------------------------------ */
function prebake() {
  const t0 = performance.now();
  baked = [];
  const { mn, mx } = target.piece.bounds();
  const pts = [
    new THREE.Vector3(0, 0, mx.z),
    new THREE.Vector3(mn.x * 0.45, mx.y * 0.4, mx.z),
    new THREE.Vector3(mx.x * 0.45, mn.y * 0.4, mx.z),
    new THREE.Vector3(mx.x * 0.4, mx.y * 0.35, mx.z)];
  const dir = new THREE.Vector3(0, 0, -1);
  for (let i = 0; i < pts.length; i++) {
    const imp: Impact = { point: pts[i], dir, energy: +ui.e.value, radius: 0.02 };
    baked.push({ impact: imp, frags: fracture(target.piece, target.mat, imp, +ui.b.value, 1000 + i).fragments });
  }
  bakeMs = performance.now() - t0;
}

/* ------------------------------------------------------------------ */
/* applying a fracture                                                  */
/* ------------------------------------------------------------------ */
const MAX_BODIES = 190;

function spawnFragments(
  frags: Fragment[], origin: THREE.Vector3, quat: THREE.Quaternion, m: MaterialDef,
  imp: Impact, energy: number, baseVel: THREE.Vector3,
) {
  const so = surfOpts(m);
  const mats = makeSurfaceMats(m, true);
  frags.sort((a, b) => b.volume - a.volume);
  const totalMass = frags.reduce((s, f) => s + f.volume * m.density, 0) + 1e-9;

  frags.forEach((f, i) => {
    const c = f.centroid;
    const local = new Piece(f.piece.verts.map(v => v.clone().sub(c)), f.piece.faces);
    const mass = f.volume * m.density;
    const worldPos = c.clone().applyQuaternion(quat).add(origin);

    if (i >= MAX_BODIES || f.volume < m.minFragment * 0.9) { spawnDebris(worldPos, m, 1); return; }

    const geo = buildGeometry(local, so, c);
    const mesh = new THREE.Mesh(geo, mats); // one shared material pair for the whole shatter
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.copy(worldPos); mesh.quaternion.copy(quat);
    scene.add(mesh);

    const body = new CANNON.Body({
      mass: Math.max(0.004, mass), material: defaultMat,
      shape: cannonConvex(f.piece, c),
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z),
      quaternion: new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w),
      linearDamping: 0.02, angularDamping: 0.06,
      allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.4,
    });
    body.material = defaultMat;

    // ejection: remaining kinetic energy shared by mass, biased to the
    // fragments that were born at the impact site
    const radial = c.clone().sub(imp.point);
    if (radial.lengthSq() < 1e-8) radial.copy(imp.dir);
    radial.normalize().applyQuaternion(quat);
    const along = imp.dir.clone().applyQuaternion(quat);
    const share = (0.10 + 0.9 * f.proximity ** 2);
    const v = Math.min(18, Math.sqrt(2 * (energy * 0.22) * share / (totalMass + mass)) * (0.6 + Math.random() * 0.7));
    const dirv = radial.multiplyScalar(0.75).addScaledVector(along, 0.9).normalize();
    body.velocity.set(
      baseVel.x + dirv.x * v, baseVel.y + dirv.y * v + 0.25 * Math.random(), baseVel.z + dirv.z * v);
    body.angularVelocity.set((Math.random() - 0.5) * 14 * share, (Math.random() - 0.5) * 14 * share, (Math.random() - 0.5) * 14 * share);
    world.addBody(body);

    const rec: Body3 = { mesh, body, mat: m, vol: f.volume, fractured: false, born: performance.now() };
    (rec as any).piece = local;
    dynamics.push(rec);

    if (ui.dust.checked && f.proximity > 0.55 && Math.random() < 0.5) spawnDebris(worldPos, m, 1);
  });
  stats.frags = frags.length;
  stats.bodies = dynamics.length;
}

/** Rebar / hinge constraints: nearby fragments crossed by the same bar stay tied. */
function linkRebar(m: MaterialDef, origin: THREE.Vector3) {
  if (!ui.rebar.checked || (m.id !== 'concrete' && m.id !== 'plastic' && m.id !== 'wood')) return;
  const maxDist = m.id === 'concrete' ? 0.38 : 0.3;
  const list = dynamics.slice(0, 120);
  let made = 0;
  for (let i = 0; i < list.length && made < 90; i++) {
    for (let j = i + 1; j < list.length && made < 90; j++) {
      const a = list[i], b = list[j];
      const d = a.mesh.position.distanceTo(b.mesh.position);
      if (d > maxDist) continue;
      const tie = m.id === 'concrete' ? 0.5 : m.id === 'wood' ? 0.22 : 0.3;
      if (Math.random() > tie) continue;
      const pivotA = new CANNON.Vec3(
        (b.mesh.position.x - a.mesh.position.x) / 2, (b.mesh.position.y - a.mesh.position.y) / 2,
        (b.mesh.position.z - a.mesh.position.z) / 2);
      const c = new CANNON.PointToPointConstraint(a.body, pivotA, b.body, pivotA.scale(-1));
      c.collideConnected = true;
      (c as any).maxForce = m.id === 'concrete' ? 1400 : 220; // bar yields, then snaps
      world.addConstraint(c); constraints.push(c); made++;
    }
  }
}

function applyImpact(worldPoint: THREE.Vector3, dirWorld: THREE.Vector3, energy: number, projVel: THREE.Vector3) {
  if (!targetMesh || !targetBody || !intact) return;
  const m = target.mat;
  const quat = targetMesh.quaternion.clone();
  const inv = quat.clone().invert();
  const local = worldPoint.clone().sub(targetMesh.position).applyQuaternion(inv);
  const localDir = dirWorld.clone().applyQuaternion(inv).normalize();

  // ---- sub-critical hit on annealed glass: crack but hold -----------
  if (m.transmission && m.storedEnergy === 0 && energy < 55 && damageHits < 3) {
    paintDamage(local, energy);
    playImpact('glass', energy, false);
    return;
  }

  const imp: Impact = { point: local, dir: localDir, energy, radius: 0.015 + energy / 9000 };
  let frags: Fragment[]; let ms: number; let area: number;

  if (ui.bake.checked && baked.length) {
    // pick the nearest baked pattern -> zero solve cost at hit time
    let best = baked[0], bd = Infinity;
    for (const b of baked) { const d = b.impact.point.distanceTo(local); if (d < bd) { bd = d; best = b; } }
    frags = best.frags.map(f => ({ ...f, piece: f.piece.clone(), centroid: f.centroid.clone() }));
    ms = 0; area = 0;
  } else {
    const r = fracture(target.piece, m, imp, +ui.b.value, (Math.random() * 1e6) | 0);
    frags = r.fragments; ms = r.ms; area = r.crackArea;
  }
  stats.ms = ms; stats.area = area;

  const origin = targetMesh.position.clone();
  scene.remove(targetMesh); disposeObj(targetMesh);
  world.removeBody(targetBody);
  if (damageMesh) { scene.remove(damageMesh); disposeObj(damageMesh); damageMesh = null; }
  targetMesh = null; targetBody = null; intact = false;

  const carry = target.static ? new THREE.Vector3() : projVel.clone().multiplyScalar(0.02);
  spawnFragments(frags, origin, quat, m, imp, energy, carry);
  linkRebar(m, origin);
  if (ui.dust.checked) puffDust(worldPoint, m, energy);
  playImpact(m.sound ?? 'stone', energy, true);
  updateStats();
}

/* --- secondary fracture: a fragment that lands hard breaks again ---- */
function trySecondary(d: Body3, impulse: number, contact: THREE.Vector3, normal: THREE.Vector3) {
  if (!ui.secondary.checked || d.fractured) return;
  if (dynamics.length > MAX_BODIES) return;
  const m = d.mat;
  const speed = d.body.velocity.length();
  const energy = 0.5 * d.body.mass * speed * speed;
  const need = m.Gc * 0.02 + 6;
  if (energy < need || d.vol < m.minFragment * 30 || impulse < 1.2) return;

  const mesh = d.mesh as THREE.Mesh;
  const quat = mesh.quaternion.clone();
  const inv = quat.clone().invert();
  const piece = (d as any).piece as Piece;
  if (!piece) return;
  const local = contact.clone().sub(mesh.position).applyQuaternion(inv);
  const imp: Impact = { point: local, dir: normal.clone().applyQuaternion(inv).normalize(), energy: energy * 0.6, radius: 0.01 };
  const r = fracture(piece, m, imp, 14, (Math.random() * 1e6) | 0);
  if (r.fragments.length < 2) { d.fractured = true; return; }

  const vel = new THREE.Vector3(d.body.velocity.x, d.body.velocity.y, d.body.velocity.z).multiplyScalar(0.4);
  removeDynamic(d);
  spawnFragments(r.fragments, mesh.position.clone(), quat, m, imp, energy * 0.5, vel);
  playImpact(m.sound ?? 'stone', energy, false);
}

function removeDynamic(d: Body3) {
  const i = dynamics.indexOf(d);
  if (i >= 0) dynamics.splice(i, 1);
  scene.remove(d.mesh); disposeObj(d.mesh, true); world.removeBody(d.body);
}

/* ------------------------------------------------------------------ */
/* dust + micro debris                                                  */
/* ------------------------------------------------------------------ */
interface Puff { pts: THREE.Points; vel: Float32Array; life: number; max: number }
const puffs: Puff[] = [];
function puffDust(at: THREE.Vector3, m: MaterialDef, energy: number) {
  const n = Math.min(900, Math.round(energy * m.dustPerJoule * 1.2) + 40);
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
    const s = 0.6 + Math.random() * (1.5 + energy / 300);
    vel[i * 3] = (Math.random() - 0.5) * s;
    vel[i * 3 + 1] = (Math.random() - 0.2) * s;
    vel[i * 3 + 2] = (Math.random() - 0.5) * s;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: m.transmission ? 0xdff3ff : m.interiorColor, size: m.transmission ? 0.012 : 0.02,
    transparent: true, opacity: 0.8, depthWrite: false, blending: m.transmission ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const p = new THREE.Points(g, mat);
  scene.add(p);
  puffs.push({ pts: p, vel, life: 0, max: m.transmission ? 1.6 : 2.6 });
}
function spawnDebris(at: THREE.Vector3, m: MaterialDef, n: number) { puffDust(at, m, 6 * n); }

function stepPuffs(dt: number) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life += dt;
    const pos = p.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let k = 0; k < a.length; k += 3) {
      p.vel[k + 1] -= 3.2 * dt;
      p.vel[k] *= 0.97; p.vel[k + 1] *= 0.985; p.vel[k + 2] *= 0.97;
      a[k] += p.vel[k] * dt; a[k + 1] += p.vel[k + 1] * dt; a[k + 2] += p.vel[k + 2] * dt;
      if (a[k + 1] < 0.004) { a[k + 1] = 0.004; p.vel[k + 1] = 0; p.vel[k] *= 0.6; p.vel[k + 2] *= 0.6; }
    }
    pos.needsUpdate = true;
    (p.pts.material as THREE.PointsMaterial).opacity = 0.8 * (1 - p.life / p.max);
    if (p.life > p.max) { scene.remove(p.pts); disposeObj(p.pts); puffs.splice(i, 1); }
  }
}

/* ------------------------------------------------------------------ */
/* projectile                                                           */
/* ------------------------------------------------------------------ */
interface Proj { mesh: THREE.Mesh; body: CANNON.Body; energy: number; born: number; prev: THREE.Vector3 }
const projectiles: Proj[] = [];
const projGeo = new THREE.SphereGeometry(0.035, 16, 12);
const projMat = new THREE.MeshStandardMaterial({ color: 0xffb648, roughness: 0.3, metalness: 0.9, emissive: 0x341a00 });

function shootAt(pointWorld: THREE.Vector3) {
  ensureAudio();
  const mass = +ui.m.value;
  const energy = +ui.e.value;
  const speed = Math.min(220, Math.sqrt((2 * energy) / mass));
  const from = camera.position.clone();
  const dir = pointWorld.clone().sub(from).normalize();
  const mesh = new THREE.Mesh(projGeo, projMat);
  mesh.castShadow = true;
  mesh.position.copy(from);
  scene.add(mesh);
  const body = new CANNON.Body({
    mass, shape: new CANNON.Sphere(0.035), material: defaultMat,
    position: new CANNON.Vec3(from.x, from.y, from.z),
    velocity: new CANNON.Vec3(dir.x * speed, dir.y * speed, dir.z * speed),
  });
  world.addBody(body);
  projectiles.push({ mesh, body, energy, born: performance.now(), prev: from.clone() });
}

/* ------------------------------------------------------------------ */
/* input                                                                */
/* ------------------------------------------------------------------ */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickPoint(ev?: PointerEvent): THREE.Vector3 {
  if (ev) ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  else ndc.set(0, 0);
  ray.setFromCamera(ndc, camera);
  const objs: THREE.Object3D[] = [];
  if (targetMesh) objs.push(targetMesh);
  for (const d of dynamics) objs.push(d.mesh);
  objs.push(ground);
  const hit = ray.intersectObjects(objs, false)[0];
  return hit ? hit.point.clone() : ray.ray.at(6, new THREE.Vector3());
}

let dragged = false;
renderer.domElement.addEventListener('pointerdown', () => (dragged = false));
renderer.domElement.addEventListener('pointermove', e => { if (e.buttons) dragged = true; });
renderer.domElement.addEventListener('pointerup', (e: PointerEvent) => {
  if (dragged || e.button !== 0) return;
  shootAt(pickPoint(e));
});
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); shootAt(pickPoint()); }
  if (e.code === 'KeyR') reset();
});

/* ------------------------------------------------------------------ */
/* collisions                                                          */
/* ------------------------------------------------------------------ */
world.addEventListener('postStep', () => {
  // fragment lands hard -> secondary comminution
  for (const eq of world.contacts) {
    const a = dynamics.find(x => x.body === eq.bi), b = dynamics.find(x => x.body === eq.bj);
    for (const d of [a, b]) {
      if (!d || d.fractured) continue;
      if (performance.now() - d.born < 90) continue;
      const v = d.body.velocity.length();
      if (v > 7) {
        const n = new THREE.Vector3(eq.ni.x, eq.ni.y, eq.ni.z);
        const cp = new THREE.Vector3(d.body.position.x, d.body.position.y, d.body.position.z);
        trySecondary(d, v * d.body.mass, cp, n.negate());
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* ui wiring                                                           */
/* ------------------------------------------------------------------ */
const fmt = (v: number, u: string) => `${v}${u}`;
function syncLabels() {
  (document.getElementById('eV') as HTMLElement).textContent = fmt(+ui.e.value, ' J');
  (document.getElementById('mV') as HTMLElement).textContent = `${(+ui.m.value * 1000).toFixed(0)} g`;
  (document.getElementById('bV') as HTMLElement).textContent = `${ui.b.value}`;
  (document.getElementById('rV') as HTMLElement).textContent = `${ui.r.value}%`;
}
for (const el of [ui.e, ui.m, ui.b, ui.r]) el.addEventListener('input', syncLabels);
ui.mat.addEventListener('change', reset);
ui.bake.addEventListener('change', () => { if (ui.bake.checked && intact) { prebake(); updateStats(); } });
(document.getElementById('shoot') as HTMLButtonElement).onclick = () => shootAt(pickPoint());
(document.getElementById('reset') as HTMLButtonElement).onclick = reset;

function updateStats() {
  const m = target?.mat;
  ui.statsEl.innerHTML = [
    `material G<sub>c</sub> <span>${m ? m.Gc : 0} J/m²</span> · ρ <span>${m ? m.density : 0} kg/m³</span>`,
    `fragments <span>${stats.frags}</span> · rigid bodies <span>${dynamics.length}</span>`,
    `solve <span>${stats.ms.toFixed(1)} ms</span>${ui.bake.checked ? ` (baked ${bakeMs.toFixed(0)} ms)` : ''}`,
    `new crack area <span>${(stats.area * 1e4).toFixed(0)} cm²</span>`,
    `constraints <span>${constraints.length}</span> · fps <span>${stats.fps.toFixed(0)}</span>`,
  ].join('<br>');
}

/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */
let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsT += dt; fpsN++;
  if (fpsT > 0.5) { stats.fps = fpsN / fpsT; fpsT = 0; fpsN = 0; updateStats(); }

  const scale = ui.slowmo.checked ? 0.22 : 1;
  acc += dt * scale;
  const h = 1 / 90;
  let steps = 0;
  while (acc >= h && steps++ < 4) { world.step(h); acc -= h; }

  for (const d of dynamics) {
    d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
    d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
  }
  // swept ray test: bullets move metres per step, so never rely on contacts
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const cur = new THREE.Vector3(p.body.position.x, p.body.position.y, p.body.position.z);
    const seg = cur.clone().sub(p.prev);
    const len = seg.length();
    let consumed = false;
    if (len > 1e-5) {
      ray.set(p.prev, seg.clone().normalize());
      ray.far = len + 0.04;
      const objs: THREE.Object3D[] = [];
      if (targetMesh) objs.push(targetMesh);
      for (const d of dynamics) objs.push(d.mesh);
      const hit = ray.intersectObjects(objs, false)[0];
      if (hit) {
        const vel = new THREE.Vector3(p.body.velocity.x, p.body.velocity.y, p.body.velocity.z);
        const dir = vel.clone().normalize();
        const e = Math.max(1, 0.5 * p.body.mass * vel.lengthSq());
        if (targetMesh && hit.object === targetMesh) {
          applyImpact(hit.point, dir, e, vel);
          consumed = true;
        } else {
          const d = dynamics.find(x => x.mesh === hit.object);
          if (d) {
            d.body.applyImpulse(new CANNON.Vec3(dir.x, dir.y, dir.z).scale(p.body.mass * vel.length()),
              new CANNON.Vec3(hit.point.x - d.body.position.x, hit.point.y - d.body.position.y, hit.point.z - d.body.position.z));
            trySecondary(d, e, hit.point, dir);
            consumed = true;
          }
        }
      }
      ray.far = Infinity;
    }
    p.prev.copy(cur);
    p.mesh.position.copy(cur);
    if (consumed || performance.now() - p.born > 9000 || cur.y < -3) {
      scene.remove(p.mesh); world.removeBody(p.body); projectiles.splice(i, 1);
    }
  }
  stepPuffs(dt * scale);

  // retire far-away / sleeping debris to keep the sim cheap
  if (dynamics.length > MAX_BODIES) {
    dynamics.slice().sort((a, b) => a.vol - b.vol).slice(0, dynamics.length - MAX_BODIES)
      .forEach(d => { if (d.body.sleepState === CANNON.Body.SLEEPING) removeDynamic(d); });
  }

  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

syncLabels();
reset();
tick();
