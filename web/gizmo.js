import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ============================================================================
//  Slate viewport — grid + workplanes + transform gizmo, dark theme.
//  Design colours match the Controls.html / editor screenshots.
// ============================================================================

const COLORS = {
  bg:        0x11151b,   // viewport background (dark slate)
  x:         0xe0483f,   // +X  red
  y:         0x7ee787,   // +Y  green
  z:         0x4a7fff,   // +Z  blue
  planeX:    0x1fc7c7,   // cyan  (YZ plane handle)
  planeY:    0xc81ec8,   // magenta (XZ plane handle)
  planeZ:    0xe0cd12,   // yellow (XY plane handle)
  ring:      0xffffff,
  grid:      0x2a3038,
  gridMajor: 0x3a4450,
};

const canvas = document.getElementById("gl");
const viewport = document.getElementById("viewport");
const readoutEl = document.getElementById("readout");

// ---- scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(4.2, 3.2, 5.0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(5, 8, 6);
scene.add(dir);

// ---- ground grid ----
const grid = new THREE.GridHelper(20, 20, COLORS.gridMajor, COLORS.grid);
grid.material.opacity = 0.55;
grid.material.transparent = true;
scene.add(grid);

// ---- world axis lines through the origin (X red, Z blue on the floor) ----
function axisLine(a, b, color) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
  return new THREE.Line(g, m);
}
scene.add(axisLine(new THREE.Vector3(-10, 0.001, 0), new THREE.Vector3(10, 0.001, 0), COLORS.x));
scene.add(axisLine(new THREE.Vector3(0, 0.001, -10), new THREE.Vector3(0, 0.001, 10), COLORS.z));

// ============================================================================
//  WORKPLANES — three translucent quads (XY, YZ, XZ), as the sketch planes
// ============================================================================
const planesGroup = new THREE.Group();
scene.add(planesGroup);

function workplane(color, quatSetup, label) {
  const S = 2.4;
  const geo = new THREE.PlaneGeometry(S, S);
  const fill = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.09,
      depthWrite: false,
    })
  );
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
  );
  const g = new THREE.Group();
  g.add(fill); g.add(frame);
  quatSetup(g);
  g.userData.label = label;
  planesGroup.add(g);
  return g;
}
// XZ plane lies flat on the ground (the default sketch plane / "Ground")
workplane(COLORS.planeY, (g) => { g.rotation.x = -Math.PI / 2; }, "Ground (XZ)");
// XY plane stands up facing +Z
workplane(COLORS.planeZ, (g) => {}, "Front (XY)");
// YZ plane stands up facing +X
workplane(COLORS.planeX, (g) => { g.rotation.y = Math.PI / 2; }, "Right (YZ)");

// ============================================================================
//  TARGET the gizmo manipulates
// ============================================================================
const target = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x8b95a4, roughness: 0.55, metalness: 0.08 })
);
target.position.set(0, 0.5, 0);
scene.add(target);

const gizmo = new THREE.Group();
scene.add(gizmo);
function syncGizmoToTarget() {
  gizmo.position.copy(target.position);
  gizmo.quaternion.copy(target.quaternion);
}

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 });
}

const AXES = [
  { name: "x", color: COLORS.x, dir: new THREE.Vector3(1, 0, 0) },
  { name: "y", color: COLORS.y, dir: new THREE.Vector3(0, 1, 0) },
  { name: "z", color: COLORS.z, dir: new THREE.Vector3(0, 0, 1) },
];
const OTHERS = {
  x: { u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(0, 0, 1), plane: COLORS.planeX },
  y: { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1), plane: COLORS.planeY },
  z: { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), plane: COLORS.planeZ },
};
const L = 1.1, TIP = L * 0.95;

function orientY(mesh, d) {
  const q = new THREE.Quaternion();
  q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  mesh.quaternion.copy(q);
}
function arcBar(u, v, innerR, outerR, sweep, segments) {
  const center = Math.PI / 4, start = center - sweep / 2;
  const positions = [], indices = [], p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const a = start + (sweep * i) / segments;
    const c = Math.cos(a), s = Math.sin(a);
    p.copy(u).multiplyScalar(innerR * c).addScaledVector(v, innerR * s);
    positions.push(p.x, p.y, p.z);
    p.copy(u).multiplyScalar(outerR * c).addScaledVector(v, outerR * s);
    positions.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const handles = [];
function registerHandle(mesh, info) {
  mesh.userData = { ...info, baseColor: new THREE.Color(info.color) };
  handles.push(mesh);
}

for (const ax of AXES) {
  const m = mat(ax.color);

  // translate: shaft line + cone tip
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, TIP - 0.2, 8), m.clone()
  );
  shaft.position.copy(ax.dir.clone().multiplyScalar((TIP - 0.2) / 2));
  orientY(shaft, ax.dir);
  gizmo.add(shaft);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 24), m.clone());
  cone.position.copy(ax.dir.clone().multiplyScalar(TIP));
  orientY(cone, ax.dir);
  gizmo.add(cone);
  registerHandle(cone, { type: "translate", axis: ax.name, dir: ax.dir.clone(), color: ax.color });

  // scale: cube inboard of the cone
  const scaleH = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), m.clone());
  scaleH.position.copy(ax.dir.clone().multiplyScalar(TIP - 0.34));
  gizmo.add(scaleH);
  registerHandle(scaleH, { type: "scale", axis: ax.name, dir: ax.dir.clone(), color: ax.color });

  // plane-translate: translucent quad at the inner corner + two opaque edges
  const other = OTHERS[ax.name], half = 0.09;
  const corner = other.u.clone().add(other.v).multiplyScalar(TIP - half - 0.32);
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshBasicMaterial({ color: other.plane, side: THREE.DoubleSide, transparent: true, opacity: 0.3 })
  );
  fill.position.copy(corner);
  orientY(fill, ax.dir); fill.rotateX(Math.PI / 2);
  gizmo.add(fill);
  registerHandle(fill, {
    type: "plane", axis: ax.name, normal: ax.dir.clone(),
    u: other.u.clone(), v: other.v.clone(), color: other.plane,
  });
  const outer = corner.clone().addScaledVector(other.u, half).addScaledVector(other.v, half);
  const backU = outer.clone().addScaledVector(other.u, -half * 2);
  const backV = outer.clone().addScaledVector(other.v, -half * 2);
  gizmo.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([backU, outer, backV]),
    new THREE.LineBasicMaterial({ color: other.plane })
  ));

  // rotate: flat curved bar between the two other cones
  const arcRadius = TIP * 0.62, arcSweep = THREE.MathUtils.degToRad(34), arcBand = 0.04;
  const arc = new THREE.Mesh(
    arcBar(other.u, other.v, arcRadius - arcBand, arcRadius + arcBand, arcSweep, 24),
    new THREE.MeshStandardMaterial({ color: ax.color, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide })
  );
  gizmo.add(arc);
  registerHandle(arc, { type: "rotate", axis: ax.name, dir: ax.dir.clone(), color: ax.color });
}

// center white ring, camera-facing
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.17, 0.008, 12, 48),
  new THREE.MeshBasicMaterial({ color: COLORS.ring })
);
gizmo.add(ring);

// ============================================================================
//  INTERACTION — hover highlight + drag translate / scale / rotate / plane
// ============================================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null, drag = null;

const SNAP_MOVE = 0.25, SNAP_SCALE = 0.1, SNAP_ANGLE = THREE.MathUtils.degToRad(5);

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function worldDir(localDir) {
  return localDir.clone().applyQuaternion(target.quaternion).normalize();
}
function highlight(mesh, on) {
  if (!mesh) return;
  const mtl = mesh.material;
  if (mtl.emissive) mtl.emissive.setHex(on ? 0x555555 : 0x000000);
  if (mtl.transparent && mesh.userData.type === "plane") mtl.opacity = on ? 0.6 : 0.3;
  mtl.needsUpdate = true;
}
function axisParamUnderPointer(axisDirWorld) {
  raycaster.setFromCamera(pointer, camera);
  const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
  const po = gizmo.position, pd = axisDirWorld;
  const w0 = new THREE.Vector3().subVectors(po, ro);
  const a = pd.dot(pd), b = pd.dot(rd), c = rd.dot(rd), d = pd.dot(w0), e = rd.dot(w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-6) return 0;
  return (b * e - c * d) / denom;
}
function planePointUnderPointer(nWorld) {
  raycaster.setFromCamera(pointer, camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nWorld, gizmo.position);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}
function angleUnderPointer(axisDirWorld, refWorld) {
  const hit = planePointUnderPointer(axisDirWorld);
  if (!hit) return 0;
  const rel = new THREE.Vector3().subVectors(hit, gizmo.position);
  const ref = refWorld.clone().projectOnPlane(axisDirWorld).normalize();
  const bit = new THREE.Vector3().crossVectors(axisDirWorld, ref).normalize();
  return Math.atan2(rel.dot(bit), rel.dot(ref));
}

function showReadout(t) { readoutEl.textContent = t; readoutEl.classList.remove("hidden"); }
function hideReadout() { readoutEl.classList.add("hidden"); }

renderer.domElement.addEventListener("pointermove", (e) => {
  setPointer(e);
  if (drag) { performDrag(e); return; }
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(handles, false);
  const next = hits.length ? hits[0].object : null;
  if (next !== hovered) { highlight(hovered, false); highlight(next, true); hovered = next; }
  renderer.domElement.style.cursor = next ? "grab" : "default";
});

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(handles, false);
  if (!hits.length) return;
  const h = hits[0].object, info = h.userData;
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
  renderer.domElement.style.cursor = "grabbing";

  drag = { info, mesh: h };
  if (info.type === "translate") {
    drag.axisWorld = worldDir(info.dir);
    drag.startParam = axisParamUnderPointer(drag.axisWorld);
    drag.startPos = target.position.clone();
  } else if (info.type === "scale") {
    drag.axisWorld = worldDir(info.dir);
    drag.startParam = axisParamUnderPointer(drag.axisWorld);
    drag.startScale = target.scale.clone();
  } else if (info.type === "plane") {
    drag.normalWorld = worldDir(info.normal);
    drag.startHit = planePointUnderPointer(drag.normalWorld);
    drag.startPos = target.position.clone();
  } else if (info.type === "rotate") {
    drag.axisWorld = worldDir(info.dir);
    const refLocal = info.axis === "y" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    drag.refWorld = worldDir(refLocal);
    drag.startAngle = angleUnderPointer(drag.axisWorld, drag.refWorld);
    drag.startQuat = target.quaternion.clone();
  }
});

function endDrag(e) {
  if (!drag) return;
  drag = null; controls.enabled = true; hideReadout();
  if (e) { try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {} }
  renderer.domElement.style.cursor = hovered ? "grab" : "default";
}
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

function performDrag(e) {
  const snap = e.ctrlKey || e.metaKey;
  const info = drag.info;
  if (info.type === "translate") {
    let delta = axisParamUnderPointer(drag.axisWorld) - drag.startParam;
    if (snap) delta = Math.round(delta / SNAP_MOVE) * SNAP_MOVE;
    target.position.copy(drag.startPos).addScaledVector(drag.axisWorld, delta);
    showReadout(`move ${info.axis.toUpperCase()}  ${delta.toFixed(2)}`);
  } else if (info.type === "scale") {
    let delta = axisParamUnderPointer(drag.axisWorld) - drag.startParam;
    if (snap) delta = Math.round(delta / SNAP_SCALE) * SNAP_SCALE;
    const s = drag.startScale.clone();
    const k = Math.max(0.05, 1 + delta);
    if (info.axis === "x") s.x = drag.startScale.x * k;
    if (info.axis === "y") s.y = drag.startScale.y * k;
    if (info.axis === "z") s.z = drag.startScale.z * k;
    target.scale.copy(s);
    showReadout(`scale ${info.axis.toUpperCase()}  ${k.toFixed(2)}×`);
  } else if (info.type === "plane") {
    const hit = planePointUnderPointer(drag.normalWorld);
    if (hit && drag.startHit) {
      let d = new THREE.Vector3().subVectors(hit, drag.startHit);
      if (snap) {
        const u = worldDir(info.u), v = worldDir(info.v);
        let du = d.dot(u), dv = d.dot(v);
        du = Math.round(du / SNAP_MOVE) * SNAP_MOVE;
        dv = Math.round(dv / SNAP_MOVE) * SNAP_MOVE;
        d = u.multiplyScalar(du).add(v.multiplyScalar(dv));
      }
      target.position.copy(drag.startPos).add(d);
      showReadout(`plane ${info.axis.toUpperCase()}  Δ ${d.length().toFixed(2)}`);
    }
  } else if (info.type === "rotate") {
    let a = angleUnderPointer(drag.axisWorld, drag.refWorld) - drag.startAngle;
    if (snap) a = Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
    const q = new THREE.Quaternion().setFromAxisAngle(drag.axisWorld, a);
    target.quaternion.copy(q).multiply(drag.startQuat);
    showReadout(`rotate ${info.axis.toUpperCase()}  ${THREE.MathUtils.radToDeg(a).toFixed(1)}°`);
  }
}

// ============================================================================
//  CORNER NAV GIZMO (view cube-ish axis balls, top-right of viewport)
// ============================================================================
const navScene = new THREE.Scene();
const navCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
navCam.position.set(0, 0, 4);
const navGroup = new THREE.Group();
navScene.add(navGroup);

function navBall(dir, color, letter, filled) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.34, 20, 20);
  const ballMat = filled
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 });
  const ball = new THREE.Mesh(geo, ballMat);
  ball.position.copy(dir);
  g.add(ball);
  if (filled) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir]),
      new THREE.LineBasicMaterial({ color })
    );
    g.add(line);
    // letter sprite
    const cvs = document.createElement("canvas"); cvs.width = cvs.height = 64;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#0a0a0a"; ctx.font = "bold 44px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(letter, 32, 34);
    const tex = new THREE.CanvasTexture(cvs);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.scale.set(0.5, 0.5, 0.5); spr.position.copy(dir);
    g.add(spr);
  }
  navGroup.add(g);
}
navBall(new THREE.Vector3(1, 0, 0), COLORS.x, "X", true);
navBall(new THREE.Vector3(-1, 0, 0), COLORS.x, "", false);
navBall(new THREE.Vector3(0, 1, 0), COLORS.y, "Y", true);
navBall(new THREE.Vector3(0, -1, 0), COLORS.y, "", false);
navBall(new THREE.Vector3(0, 0, 1), COLORS.z, "Z", true);
navBall(new THREE.Vector3(0, 0, -1), COLORS.z, "", false);

// ============================================================================
//  RESIZE + RENDER LOOP
// ============================================================================
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

function render() {
  requestAnimationFrame(render);
  controls.update();
  syncGizmoToTarget();

  // keep gizmo a constant screen size
  const d = camera.position.distanceTo(gizmo.position);
  gizmo.scale.setScalar(d * 0.13);

  // center ring faces camera
  ring.quaternion.copy(camera.quaternion);

  // main pass
  renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);

  // nav gizmo overlay (top-right)
  const size = 96, pad = 12;
  navGroup.quaternion.copy(camera.quaternion).invert();
  renderer.clearDepth();
  renderer.setScissorTest(true);
  const x = viewport.clientWidth - size - pad;
  const y = viewport.clientHeight - size - pad;
  renderer.setViewport(x, y, size, size);
  renderer.setScissor(x, y, size, size);
  renderer.render(navScene, navCam);
  renderer.setScissorTest(false);
}
render();
