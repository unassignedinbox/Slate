import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MATERIAL_LIBRARY } from "./simulation";

const getColor = (value, fallback = "#8f9baa") => value || fallback;

function makeLineMaterial(color, opacity = 0.55) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity });
}

function buildReactor(scene) {
  const reactor = new THREE.Group();
  reactor.name = "CAN-01 reactor";
  reactor.rotation.y = -0.35;
  scene.add(reactor);

  const shellGroup = new THREE.Group();
  shellGroup.name = "Containment shell";
  reactor.add(shellGroup);
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: "#72818f",
    metalness: 0.78,
    roughness: 0.22,
    transparent: true,
    opacity: 0.19,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.34, 1.34, 3.6, 72, 1, true, -Math.PI * 0.76, Math.PI * 1.54), shellMaterial);
  shell.position.y = 0.12;
  shellGroup.add(shell);
  const shellTop = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.06, 10, 72), shellMaterial);
  shellTop.position.y = 1.92;
  shellGroup.add(shellTop);
  const shellBottom = shellTop.clone();
  shellBottom.position.y = -1.68;
  shellGroup.add(shellBottom);

  const shieldGroup = new THREE.Group();
  shieldGroup.name = "Shield stack";
  reactor.add(shieldGroup);
  const shieldMaterial = new THREE.MeshPhysicalMaterial({
    color: "#7f909e",
    metalness: 0.55,
    roughness: 0.32,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.13, 1.13, 3.12, 64, 1, true, 0, Math.PI * 1.9), shieldMaterial);
  shield.position.y = 0.12;
  shieldGroup.add(shield);
  for (const y of [-1.47, 1.7]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.13, 0.035, 8, 64), shieldMaterial);
    ring.position.y = y;
    shieldGroup.add(ring);
  }

  const coreGroup = new THREE.Group();
  coreGroup.name = "Core module";
  reactor.add(coreGroup);
  const coreBodyMaterial = new THREE.MeshStandardMaterial({ color: "#151c25", metalness: 0.35, roughness: 0.48 });
  const coreBody = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 1.94, 48), coreBodyMaterial);
  coreBody.position.y = 0.1;
  coreGroup.add(coreBody);

  const rodGroup = new THREE.Group();
  rodGroup.name = "Fuel rods";
  coreGroup.add(rodGroup);
  const rods = [];
  const fuelRodGeometry = new THREE.CylinderGeometry(0.075, 0.075, 1.72, 16);
  const positions = [
    [0, 0], [0.23, 0], [-0.23, 0], [0, 0.23], [0, -0.23],
    [0.36, 0.2], [-0.36, 0.2], [0.36, -0.2], [-0.36, -0.2],
    [0.18, 0.38], [-0.18, 0.38], [0.18, -0.38], [-0.18, -0.38],
    [0.46, 0], [-0.46, 0], [0, 0.48], [0, -0.48]
  ];
  positions.forEach(([x, z], index) => {
    const material = new THREE.MeshStandardMaterial({
      color: "#edb24b",
      emissive: "#7b3512",
      emissiveIntensity: 0.28,
      metalness: 0.25,
      roughness: 0.3
    });
    const mesh = new THREE.Mesh(fuelRodGeometry, material);
    mesh.position.set(x, 0.1, z);
    mesh.userData.index = index;
    rodGroup.add(mesh);
    rods.push(mesh);
  });

  const controlGroup = new THREE.Group();
  controlGroup.name = "Control blades";
  coreGroup.add(controlGroup);
  const controlRods = [];
  [[0.52, 0.32], [-0.52, 0.32], [0.52, -0.32], [-0.52, -0.32]].forEach(([x, z], index) => {
    const material = new THREE.MeshStandardMaterial({ color: "#272f3a", metalness: 0.7, roughness: 0.3 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 2.35, 12), material);
    rod.position.set(x, 0.62, z);
    controlGroup.add(rod);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8), new THREE.MeshStandardMaterial({ color: "#8ca7c0", emissive: "#25425b", emissiveIntensity: 0.8 }));
    cap.position.set(x, 1.82, z);
    controlGroup.add(cap);
    controlRods.push({ rod, cap, index });
  });

  const coolantGroup = new THREE.Group();
  coolantGroup.name = "Coolant loop";
  reactor.add(coolantGroup);
  const coolantTubeMaterial = new THREE.MeshStandardMaterial({ color: "#5fc9ee", emissive: "#0b6588", emissiveIntensity: 0.65, metalness: 0.3, roughness: 0.22, transparent: true, opacity: 0.84 });
  const coolantTubes = [];
  [-0.88, 0, 0.88].forEach((y, index) => {
    const tube = new THREE.Mesh(new THREE.TorusGeometry(0.93, index === 1 ? 0.035 : 0.025, 10, 80), coolantTubeMaterial.clone());
    tube.rotation.x = Math.PI / 2;
    tube.position.y = y;
    coolantGroup.add(tube);
    coolantTubes.push(tube);
  });
  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.72, 24), coolantTubeMaterial.clone());
  inlet.rotation.z = Math.PI / 2;
  inlet.position.set(-1.15, -0.48, 0);
  coolantGroup.add(inlet);
  const outlet = inlet.clone();
  outlet.position.set(1.15, 0.85, 0);
  coolantGroup.add(outlet);

  const particleGroup = new THREE.Group();
  particleGroup.name = "Coolant flow";
  coolantGroup.add(particleGroup);
  const particles = [];
  for (let i = 0; i < 22; i += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.034 + (i % 3) * 0.008, 8, 8), new THREE.MeshBasicMaterial({ color: "#b7edff", transparent: true, opacity: 0.9 }));
    particle.userData.phase = i / 22;
    particleGroup.add(particle);
    particles.push(particle);
  }

  const radiationGroup = new THREE.Group();
  radiationGroup.name = "Radiation field";
  reactor.add(radiationGroup);
  const haloMaterial = new THREE.MeshBasicMaterial({ color: "#916cff", wireframe: true, transparent: true, opacity: 0.055, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.64, 20, 14), haloMaterial);
  halo.scale.y = 1.22;
  radiationGroup.add(halo);
  const radiationRing = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.012, 6, 80), new THREE.MeshBasicMaterial({ color: "#a68cff", transparent: true, opacity: 0.38 }));
  radiationRing.rotation.x = Math.PI / 2;
  radiationGroup.add(radiationRing);

  const axisGroup = new THREE.Group();
  axisGroup.name = "Axis guide";
  reactor.add(axisGroup);
  const axisMaterial = makeLineMaterial("#566274", 0.35);
  const axisGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.75, 0, 0), new THREE.Vector3(1.75, 0, 0)]);
  const axis = new THREE.Line(axisGeometry, axisMaterial);
  axis.position.y = -1.86;
  axisGroup.add(axis);

  return { reactor, shellGroup, shell, shieldGroup, shield, coreGroup, coreBody, rods, controlRods, coolantGroup, coolantTubes, particles, radiationGroup, halo, radiationRing };
}

export default function ReactorViewport({ materials, snapshot, viewMode, labelsVisible = true }) {
  const mountRef = useRef(null);
  const modelRef = useRef(null);
  const settingsRef = useRef({ materials, snapshot, viewMode, labelsVisible });
  const frameRef = useRef(0);

  settingsRef.current = { materials, snapshot, viewMode, labelsVisible };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#07090c");
    scene.fog = new THREE.Fog("#07090c", 9, 17);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(4.8, 3.2, 5.4);
    camera.lookAt(0, 0.1, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 3.5;
    controls.maxDistance = 8.5;
    controls.target.set(0, 0.1, 0);

    scene.add(new THREE.HemisphereLight("#dceaff", "#14151c", 1.4));
    const key = new THREE.DirectionalLight("#ffffff", 3.2);
    key.position.set(3.6, 6.2, 4.2);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight("#7164ff", 3.8, 8, 2);
    rim.position.set(-3.4, 1.8, -2.7);
    scene.add(rim);
    const cyan = new THREE.PointLight("#1ab8e8", 2.4, 6, 2);
    cyan.position.set(2.3, -1, 2.7);
    scene.add(cyan);

    const grid = new THREE.GridHelper(11, 28, "#293346", "#111824");
    grid.position.y = -2.05;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.1, 64), new THREE.MeshBasicMaterial({ color: "#0a0e15", transparent: true, opacity: 0.75 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.04;
    scene.add(floor);

    const model = buildReactor(scene);
    modelRef.current = model;
    const clock = new THREE.Clock();

    const onResize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);
    onResize();

    const render = () => {
      const elapsed = clock.getElapsedTime();
      const settings = settingsRef.current;
      const data = settings.snapshot || {};
      const mode = settings.viewMode || {};
      const currentMaterials = settings.materials || {};
      const power = Math.min(1, (data.powerThermal || 0) / 6.4);
      const vibration = Math.min(1, Math.abs(data.vibrationObserved || 0) / 0.92);
      const tempNorm = Math.min(1.3, Math.max(0, ((data.temperatureObserved || 450) - 400) / 360));
      const explode = mode.exploded ? 1 : 0;

      model.reactor.position.y = Math.sin(elapsed * 0.45) * 0.018;
      model.reactor.position.x = Math.sin(elapsed * 20.0) * vibration * 0.012;
      model.reactor.rotation.z = Math.sin(elapsed * 15.4) * vibration * 0.004;
      model.shellGroup.position.y = explode * 0.34;
      model.shieldGroup.position.y = explode * 0.12;
      model.coreGroup.position.y = -explode * 0.08;
      model.coolantGroup.position.y = explode * 0.06;
      model.radiationGroup.visible = Boolean(mode.radiation);
      model.shellGroup.visible = true;
      model.shell.material.opacity = mode.cutaway ? 0.24 : 0.13;
      model.shield.material.opacity = mode.cutaway ? 0.45 : 0.22;

      const fuel = currentMaterials.fuel || MATERIAL_LIBRARY.fuel.ceramic;
      const cladding = currentMaterials.cladding || MATERIAL_LIBRARY.cladding.sic;
      const coolant = currentMaterials.coolant || MATERIAL_LIBRARY.coolant.helium;
      const shield = currentMaterials.shield || MATERIAL_LIBRARY.shield.tungsten;
      model.coreBody.material.color.set("#111823");
      model.coreBody.material.emissive.set(fuel.color);
      model.coreBody.material.emissiveIntensity = 0.08 + power * 0.34;
      model.shield.material.color.set(getColor(shield.color));
      model.shell.material.color.set(getColor(cladding.color));
      model.coolantTubes.forEach((tube, index) => {
        tube.material.color.set(getColor(coolant.color));
        tube.material.emissive.set(getColor(coolant.color));
        tube.material.emissiveIntensity = 0.4 + power * 0.75;
        tube.rotation.z = elapsed * (0.08 + power * 0.22) * (index % 2 ? -1 : 1);
      });
      model.rods.forEach((rod) => {
        rod.material.color.set(getColor(fuel.color));
        rod.material.emissive.set(getColor(fuel.color));
        rod.material.emissiveIntensity = 0.11 + power * 0.9 + tempNorm * 0.12;
      });
      model.controlRods.forEach(({ rod, cap }, index) => {
        const insertion = Math.min(1.08, Math.max(0.12, 1 - (data.inputs?.control || 0.62) + index * 0.015));
        rod.position.y = 0.55 + insertion * 0.55;
        cap.position.y = 1.75 + insertion * 0.55;
      });

      model.particles.forEach((particle, index) => {
        const phase = (particle.userData.phase + elapsed * (0.055 + power * 0.12)) % 1;
        const ringIndex = index % 3;
        const radius = 0.93;
        const angle = phase * Math.PI * 2 + (ringIndex * Math.PI * 2) / 3;
        particle.position.set(Math.cos(angle) * radius, [-0.88, 0, 0.88][ringIndex], Math.sin(angle) * radius);
        particle.scale.setScalar(0.65 + power * 0.7);
      });
      model.halo.scale.set(1 + tempNorm * 0.08, 1.22 + tempNorm * 0.08, 1 + tempNorm * 0.08);
      model.halo.material.opacity = mode.radiation ? 0.06 + Math.min(0.18, (data.radiation || 0) * 0.012) : 0.018;
      model.radiationRing.rotation.y = elapsed * 0.12;
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
    };
  }, []);

  return <div className="reactor-canvas" ref={mountRef} aria-label="Interactive 3D can-scale reactor viewport" />;
}
