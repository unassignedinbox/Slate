// 3D model of the coke-can reactor, built from the same geometry the physics uses
// (layers, pin lattice, control rods). Units: the scene is in cm (1 unit = 10 mm).
// Live state drives colour (coolant and fuel temperature), fuel glow, rod position,
// poison slurry after a core kill, dose shells, and a vibration shake (exaggerated for display).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pinPositions, PIN, GUIDE, ROD_RADIUS, PIN_RINGS } from '../physics/geometry.js';

const S = 0.1;                       // scene units per mm
const COOL = new THREE.Color('#2f7fd1');
const HOT = new THREE.Color('#ff6a3d');

function ring(r1, r2, z0, z1, mat, seg = 72) {
  const pts = [
    new THREE.Vector2(r1, z0), new THREE.Vector2(r2, z0),
    new THREE.Vector2(r2, z1), new THREE.Vector2(r1, z1), new THREE.Vector2(r1, z0),
  ];
  return new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat);
}

export default function Viewport3D({ base, snapshot, showDose, exaggerate, sections }) {
  const hostRef = useRef(null);
  const snapRef = useRef(snapshot);
  const optsRef = useRef({ showDose, exaggerate, sections });
  snapRef.current = snapshot;
  optsRef.current = { showDose, exaggerate, sections };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !base) return undefined;
    const width = host.clientWidth || 600, height = host.clientHeight || 400;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor('#1a1a1a', 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 500);
    camera.position.set(14, 11, 16);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 6, 0);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight('#e8f0ff', '#202020', 1.0));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(10, 20, 12);
    scene.add(key);
    const grid = new THREE.GridHelper(30, 30, '#333333', '#262626');
    grid.position.y = -0.05;
    scene.add(grid);

    const g = base.geom;
    const root = new THREE.Group();
    scene.add(root);

    const mats = {
      vessel: new THREE.MeshStandardMaterial({ color: '#8f98a0', metalness: 0.7, roughness: 0.35 }),
      shield: new THREE.MeshStandardMaterial({ color: '#4b5160', metalness: 0.4, roughness: 0.6 }),
      refl: new THREE.MeshStandardMaterial({ color: '#6e8b74', roughness: 0.8 }),
      plenum: new THREE.MeshStandardMaterial({ color: '#2f7fd1', transparent: true, opacity: 0.35, roughness: 0.2 }),
      te: new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 0.3, roughness: 0.5 }),
      fuel: new THREE.MeshStandardMaterial({ color: '#b8583d', emissive: '#ff5522', emissiveIntensity: 0, roughness: 0.6 }),
      clad: new THREE.MeshStandardMaterial({ color: '#c5ced6', transparent: true, opacity: 0.45, metalness: 0.6, roughness: 0.3 }),
      rod: new THREE.MeshStandardMaterial({ color: '#15171a', metalness: 0.2, roughness: 0.4 }),
      guide: new THREE.MeshStandardMaterial({ color: '#7a828c', metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.7 }),
      core: new THREE.MeshStandardMaterial({ color: '#2f7fd1', transparent: true, opacity: 0.12, depthWrite: false }),
      poison: new THREE.MeshStandardMaterial({ color: '#6fbf8a', transparent: true, opacity: 0.0, depthWrite: false }),
      can: new THREE.MeshStandardMaterial({ color: '#d9dde2', transparent: true, opacity: 0.18, metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide, depthWrite: false }),
      dose: new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    };

    // Vessel and can.
    const Rin = g.R_in * S, Renv = g.R_env * S, Henv = g.H_env * S;
    const body = new THREE.Group();
    root.add(body);
    const layerMesh = [];
    for (const L of g.layers) {
      const z0 = L.z0 * S, z1 = L.z1 * S;
      if (L.role === 'vessel') {
        body.add(ring(0, Renv, z0, z1, mats.vessel, 72));
      } else if (L.role === 'shield') {
        const m = ring(g.R_core * S + g.reflT * S, Rin, z0, z1, mats.shield);
        body.add(m); layerMesh.push({ role: 'shield', m });
      } else if (L.role === 'reflector') {
        const m = ring(g.R_core * S, g.R_core * S + g.reflT * S, z0, z1, mats.refl);
        body.add(m); layerMesh.push({ role: 'reflector', m });
      } else if (L.role === 'core') {
        const m = ring(0, g.R_core * S, z0, z1, mats.core);
        body.add(m); layerMesh.push({ role: 'core', m });
      } else if (L.role === 'coolant') {
        const m = ring(0, Rin, z0, z1, mats.plenum);
        body.add(m); layerMesh.push({ role: 'coolant', m });
      } else if (L.role === 'te') {
        const m = ring(0, Rin, z0, z1, mats.te);
        body.add(m); layerMesh.push({ role: 'te', m });
      }
    }
    // Vessel wall and can envelope.
    body.add(ring(Rin, Renv, 0, Henv, mats.vessel, 96));
    const can = new THREE.Mesh(new THREE.CylinderGeometry(Renv, Renv, Henv, 96, 1, true), mats.can);
    can.position.y = Henv / 2;
    body.add(can);

    // Fuel pins and cladding (instanced).
    const pins = pinPositions();
    const core = g.layers.find((l) => l.role === 'core');
    const Hc = (core.z1 - core.z0) * S, zc = (core.z0 + core.z1) * S / 2;
    const fuelGeo = new THREE.CylinderGeometry(PIN.rFuel * S, PIN.rFuel * S, Hc, 20);
    const cladGeo = new THREE.CylinderGeometry(PIN.rCladOut * S, PIN.rCladOut * S, Hc, 20, 1, true);
    const fuelI = new THREE.InstancedMesh(fuelGeo, mats.fuel, pins.length);
    const cladI = new THREE.InstancedMesh(cladGeo, mats.clad, pins.length);
    const M = new THREE.Matrix4();
    pins.forEach((p, i) => {
      M.makeTranslation(p.x * S, zc, p.y * S);
      fuelI.setMatrixAt(i, M); cladI.setMatrixAt(i, M);
    });
    body.add(fuelI, cladI);

    // Guide tubes and control rods at the inner ring (schematic positions).
    const rodGroup = new THREE.Group();
    body.add(rodGroup);
    const inner = PIN_RINGS[0];
    const rodPos = [];
    for (let i = 0; i < inner.n; i++) {
      const a = ((inner.phaseDeg + (360 * i) / inner.n) * Math.PI) / 180;
      rodPos.push({ x: inner.r * Math.cos(a) * S, z: inner.r * Math.sin(a) * S });
    }
    const rods = rodPos.map((p) => {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(GUIDE.rOut * S, GUIDE.rOut * S, Hc, 16, 1, true), mats.guide);
      tube.position.set(p.x, zc, p.z);
      rodGroup.add(tube);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD_RADIUS * S, ROD_RADIUS * S, 1, 16), mats.rod);
      rodGroup.add(rod);
      return { rod, p };
    });

    // Poison slurry (after a core kill) and dose shells.
    const poison = new THREE.Mesh(new THREE.CylinderGeometry(g.R_core * S * 0.98, g.R_core * S * 0.98, Hc, 48), mats.poison);
    poison.position.set(0, zc, 0);
    body.add(poison);
    const shells = [1.6, 2.6].map((k) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(Renv * k, 48, 32), mats.dose.clone());
      m.position.y = Henv / 2;
      root.add(m);
      return m;
    });

    let raf;
    const t0 = performance.now();
    const tick = () => {
      const s = snapRef.current;
      const { showDose, exaggerate, sections } = optsRef.current;
      const t = (performance.now() - t0) / 1000;
      // Temperatures.
      const Tb = s ? s.TbC : 25;
      const Tf = s ? s.TfMaxC : 25;
      const destroyed = !!(s && s.destroyed);
      const frac = Math.min(1, Math.max(0, (Tb - 25) / 120));
      mats.plenum.color.copy(COOL).lerp(HOT, frac);
      mats.plenum.opacity = 0.25 + 0.3 * frac;
      mats.fuel.emissiveIntensity = destroyed ? 0 : Math.min(1, Math.max(0, (Tf - 25) / 1500)) * 1.2;
      mats.fuel.color.set(destroyed ? '#3a3a3a' : '#b8583d');
      mats.poison.opacity = destroyed ? 0.55 : 0;
      mats.core.opacity = destroyed ? 0.05 : 0.12;
      // Rods: inserted fraction from the top of the core.
      const ins = s ? Math.min(1, Math.max(0, 1 - s.rodW)) : 0;
      for (const { rod, p } of rods) {
        const len = Math.max(1e-4, ins * Hc);
        rod.scale.set(1, len, 1);
        rod.position.set(p.x, zc + Hc / 2 - len / 2, p.z);
        rod.visible = ins > 0.001;
      }
      // Dose shells.
      const dose = s ? s.dose.surface : 0;
      const lg = Math.min(1, Math.max(0, (Math.log10(Math.max(dose, 1e-6)) + 1) / 7));
      shells.forEach((m, i) => {
        m.material.opacity = showDose ? lg * (i === 0 ? 0.28 : 0.12) : 0;
        m.visible = showDose;
      });
      // Vibration shake: displacement scaled by exaggeration for visibility.
      const z = s ? s.vib.zRmsMm : 0;
      const amp = Math.min(0.8, z * exaggerate * S * 0.1);
      root.position.x = amp * Math.sin(2 * Math.PI * (s ? s.vib.fn : 0) * 0.02 * t);
      root.position.z = amp * Math.cos(2 * Math.PI * (s ? s.vib.fn : 0) * 0.017 * t);
      // Section and visibility toggles.
      const keyOf = { reflector: 'refl' };
      layerMesh.forEach(({ role, m }) => { m.visible = sections[keyOf[role] || role] !== false; });
      can.visible = sections.can !== false;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      Object.values(mats).forEach((m) => m.dispose && m.dispose());
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [base]);

  return <div className="viewport-canvas" ref={hostRef} aria-label="Reactor 3D model" />;
}
