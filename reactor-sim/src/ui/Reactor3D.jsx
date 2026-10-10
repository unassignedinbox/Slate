// To-scale 3D cutaway of the coke-can reactor. Units in the scene are millimetres.
// Colours follow live temperatures; rods show insertion depth; the fuel stack shakes with the
// simulated vibration (displacement exaggerated for visibility and labelled as such).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const GRADIENT = [
  [0.0, new THREE.Color('#2b6cb0')],
  [0.5, new THREE.Color('#e2b04a')],
  [1.0, new THREE.Color('#e0492c')],
];

export function tempColor(T, Tlo, Thi) {
  const f = Math.min(1, Math.max(0, (T - Tlo) / Math.max(1e-9, Thi - Tlo)));
  for (let i = 1; i < GRADIENT.length; i += 1) {
    const [f1, c1] = GRADIENT[i - 1];
    const [f2, c2] = GRADIENT[i];
    if (f <= f2) return c1.clone().lerp(c2, (f - f1) / (f2 - f1));
  }
  return GRADIENT[GRADIENT.length - 1][1].clone();
}

/** Solid annulus between rIn and rOut, height h, centred on y = 0 (axis = y). */
function ring(rIn, rOut, h, material) {
  const profile = [
    new THREE.Vector2(rIn, -h / 2),
    new THREE.Vector2(rOut, -h / 2),
    new THREE.Vector2(rOut, h / 2),
    new THREE.Vector2(rIn, h / 2),
  ];
  const geo = new THREE.LatheGeometry(profile, 72);
  return new THREE.Mesh(geo, material);
}

export default function Reactor3D({ geo, snap }) {
  const mountRef = useRef(null);
  const parts = useRef(null);
  const stateRef = useRef({ geo: null, snap: null });

  // one-time scene setup
  useEffect(() => {
    const mount = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
    camera.position.set(120, 85, 150);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.minDistance = 60;
    controls.maxDistance = 400;

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x18181c, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(120, 200, 140);
    scene.add(key);
    const grid = new THREE.GridHelper(260, 26, 0x2e2e2e, 0x222222);
    grid.position.y = -70;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      const p = parts.current;
      if (p && p.stack) p.stack.position.x = (p.shakeAmp || 0) * Math.sin(performance.now() * 0.09);
      renderer.render(scene, camera);
    };
    animate();

    parts.current = { renderer, scene, group, controls };
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // rebuild geometry when the design geometry changes
  useEffect(() => {
    if (!geo || !parts.current) return;
    const { group } = parts.current;
    group.clear();
    const m = (r) => r; // mm
    const mm = (x) => m(x * 1000);
    const Hc = mm(0.1222);
    const Rcan = mm(0.03305);
    const rf = mm(geo.rf);
    const H = mm(geo.H);
    const rc = mm(geo.rc);
    const r1 = mm(geo.r1);
    const r2 = mm(geo.r2);
    const r3 = mm(geo.r3);
    const r4 = mm(geo.r4);

    const matShell = (color, opacity) =>
      new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });

    // can wall (open cylinder with caps)
    const canGeo = new THREE.CylinderGeometry(Rcan, Rcan, Hc, 96, 1, true);
    const can = new THREE.Mesh(canGeo, matShell(0x9aa6b5, 0.1));
    group.add(can);
    const canEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(Rcan, Rcan, Hc, 48, 1, true)),
      new THREE.LineBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.55 }),
    );
    group.add(canEdge);

    const neutron = ring(r3, r4, Hc, matShell(0x6f9bd0, 0.55));
    neutron.userData.role = 'neutron';
    group.add(neutron);
    const gamma = ring(r2, r3, Hc, matShell(0x6b6f7a, 0.7));
    gamma.userData.role = 'gamma';
    group.add(gamma);
    const conv = ring(r1, r2, H, matShell(0xb07a3e, 0.85));
    conv.userData.role = 'converter';
    group.add(conv);

    // stack group: fuel, coolant, rods move together under vibration
    const stack = new THREE.Group();
    stack.userData.role = 'stack';
    group.add(stack);
    const coolant = ring(rf, rc, H, matShell(0x4aa3c8, 0.4));
    coolant.userData.role = 'coolant';
    stack.add(coolant);
    const fuelMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.15, emissive: 0x000000 });
    const fuel = new THREE.Mesh(new THREE.CylinderGeometry(rf, rf, H, 64), fuelMat);
    fuel.userData.role = 'fuel';
    stack.add(fuel);
    const rods = [];
    const rodR = Math.max(0.6, (rc - rf) * 0.25);
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(rodR, rodR, H, 16),
        new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6, metalness: 0.4 }),
      );
      rod.position.set(Math.cos(a) * (rf + (rc - rf) / 2), 0, Math.sin(a) * (rf + (rc - rf) / 2));
      rod.userData.angle = a;
      stack.add(rod);
      rods.push(rod);
    }
    parts.current.fuelMat = fuelMat;
    parts.current.stack = stack;
    parts.current.coolantMat = coolant.material;
    parts.current.wallMat = can.material;
    parts.current.fuelMesh = fuel;
    parts.current.rods = rods;
    parts.current.H = H;
    parts.current.neutronMat = neutron.material;
    parts.current.gammaMat = gamma.material;
    parts.current.convMat = conv.material;
    parts.current.geo = geo;
    stateRef.current.geo = geo;
    applySnapshot(parts.current, stateRef.current.snap, geo);
  }, [geo]);

  // update colours, rod positions and vibration on every snapshot
  useEffect(() => {
    stateRef.current.snap = snap;
    if (!parts.current || !parts.current.geo) return;
    applySnapshot(parts.current, snap, parts.current.geo);
  }, [snap]);

  return <div ref={mountRef} className="viewport-canvas-host" style={{ position: 'absolute', inset: 0 }} />;
}

function applySnapshot(p, snap, geo) {
  if (!snap || !geo || !p.fuelMat) return;
  const Tlo = 293;
  const Thi = geo.tFuelDamage;
  const destroyed = snap.destroyed;
  const fuelCol = destroyed ? new THREE.Color('#3b3b3b') : tempColor(snap.Tf, Tlo, Thi);
  p.fuelMat.color.copy(fuelCol);
  p.fuelMat.emissive.copy(destroyed ? new THREE.Color(0x000000) : tempColor(snap.Tf, Tlo, Thi).multiplyScalar(0.25));
  p.coolantMat.color.copy(tempColor(snap.Tc, Tlo, Thi * 0.6));
  p.wallMat.color.copy(snap.breach ? new THREE.Color('#e0492c') : new THREE.Color('#9aa6b5'));
  p.wallMat.opacity = snap.breach ? 0.3 : 0.1;
  p.convMat.color.copy(snap.converterFailed ? new THREE.Color('#5a4a3a') : new THREE.Color('#b07a3e'));

  // rods: insertion from the top, amber when stuck
  const H = p.H;
  p.rods.forEach((rod, i) => {
    const r = snap.rods[i] ?? { z: 0, stuck: false };
    const len = Math.max(0.5, r.z * H);
    rod.scale.y = len / H;
    rod.position.y = H / 2 - len / 2;
    rod.material.color.set(r.stuck ? '#b8862a' : '#1c1c1c');
  });

  // vibration: exaggerated displacement (labelled in the UI)
  // the render loop animates the shake from the wall clock (the 740 Hz motion itself is not resolvable at 10 Hz)
  p.shakeAmp = Math.min(1.5, Math.abs(snap.xMm) * 60 + snap.grms * 0.005);
}
