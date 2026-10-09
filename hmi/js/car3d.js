// Shared 3D vehicle view (Three.js). One procedural single-seater, reused by the Suspension,
// Aero and Lobby apps. It is driven entirely by telemetry frames, so the C++ side only has to
// supply numbers; no 3D assets are needed on the HMI.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CORNERS, TYRE_RADIUS, WHEELBASE, TRACK_WIDTH } from './vehicle.js';
import { tempHex } from './ui.js';

const VIS = 2.5;                 // visual exaggeration for heave / pitch / roll / road
const BASE_Y = 0.02;             // chassis height at zero load
const HALF_TRACK = TRACK_WIDTH / 2;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// Side-by-side plan extrusion. Input points are [x, z] with the nose at -z.
function plan(pointsXZ, height, base, bevel = 0.03) {
  const shape = new THREE.Shape();
  pointsXZ.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  return g;
}
const mirror = (half) => [...half, ...half.slice(1, -1).reverse().map(([x, z]) => [-x, z])];

class HelixCurve extends THREE.Curve {
  constructor(turns) { super(); this.turns = turns; }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a), t, Math.sin(a));
  }
}

function place(mesh, a, b, rad) {
  _a.subVectors(b, a);
  const len = Math.max(_a.length(), 1e-4);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _a.normalize());
  mesh.scale.set(rad, len, rad);
}

export function createCarView(container, { accent = '#2ee6c5', airflow = false, controls: interactive = true, autoRotate = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    throw new Error('WebGL unavailable');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'car-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b1016, 14, 46);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const PRESETS = {
    orbit: [[4.4, 2.3, -5.4], [0, 0.55, 0]],
    front: [[0.2, 1.1, -6.4], [0, 0.6, 0]],
    side: [[-6.8, 1.1, 0.2], [0, 0.6, 0]],
    rear: [[2.6, 1.8, 5.8], [0, 0.7, 0]],
    top: [[0.01, 9.0, 0.01], [0, 0, 0]],
  };
  camera.position.set(...PRESETS.orbit[0]);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(...PRESETS.orbit[1]);
  orbit.enableDamping = true;
  orbit.minDistance = 2.6;
  orbit.maxDistance = 13;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.enabled = interactive;
  orbit.autoRotate = autoRotate;
  orbit.autoRotateSpeed = 1.2;

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x0b1016, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(5, 9, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rimLight = new THREE.DirectionalLight(0x2ee6c5, 0.7);
  rimLight.position.set(-6, 3, 6);
  scene.add(rimLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(30, 96),
    new THREE.MeshStandardMaterial({ color: 0x0d141b, roughness: 0.9, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(40, 40, 0x2ee6c5, 0x1d2b35);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  scene.add(grid);

  // ---- materials
  const M = {
    body: new THREE.MeshStandardMaterial({ color: accent, metalness: 0.55, roughness: 0.32 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x0c1013, metalness: 0.2, roughness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x06090d, metalness: 0.9, roughness: 0.08 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.4 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.3, metalness: 0.1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc8d2dc, metalness: 1, roughness: 0.22 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa7b4, metalness: 0.9, roughness: 0.35 }),
    spring: new THREE.MeshStandardMaterial({ color: 0xffb020, metalness: 0.6, roughness: 0.4 }),
    damper: new THREE.MeshStandardMaterial({ color: 0x2f7cff, metalness: 0.5, roughness: 0.3 }),
  };

  // ---- chassis (moves with heave, pitch, roll)
  const chassis = new THREE.Group();
  scene.add(chassis);
  const add = (geo, mat, parent = chassis, pos) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (pos) m.position.set(...pos);
    parent.add(m);
    return m;
  };
  const SIDEPOD = mirror([[0, -2.5], [0.12, -2.36], [0.19, -2.0], [0.4, -1.4], [0.5, -0.7], [0.48, 0.6], [0.36, 1.5], [0.24, 2.0], [0, 2.15]]);
  add(plan(SIDEPOD, 0.42, 0.2), M.body);
  add(plan(mirror([[0, -0.6], [0.17, -0.4], [0.19, 0.5], [0, 0.62]]), 0.24, 0.6), M.carbon);   // cockpit tub
  add(plan(mirror([[0, 0.6], [0.2, 0.6], [0.2, 1.9], [0, 2.1]]), 0.34, 0.6), M.body);           // engine cover
  add(new THREE.SphereGeometry(0.13, 20, 14), M.helmet, chassis, [0, 0.86, 0.05]).scale.set(1, 1.05, 1.05);
  add(new THREE.BoxGeometry(0.2, 0.05, 0.22), M.glass, chassis, [0, 0.8, 0.1]);
  add(new THREE.BoxGeometry(0.02, 0.03, 2.9), M.stripe, chassis, [0.505, 0.6, 0]).castShadow = false;
  add(new THREE.BoxGeometry(0.02, 0.03, 2.9), M.stripe, chassis, [-0.505, 0.6, 0]).castShadow = false;
  add(new THREE.BoxGeometry(1.0, 0.04, 0.6), M.carbon, chassis, [0, 0.16, 2.0]);             // diffuser

  // Front wing (flap angle follows the front flap setting)
  const frontWing = new THREE.Group();
  frontWing.position.set(0, 0.2, -2.4);
  chassis.add(frontWing);
  add(new THREE.BoxGeometry(1.95, 0.03, 0.22), M.carbon, frontWing);
  add(new THREE.BoxGeometry(1.92, 0.025, 0.16), M.carbon, frontWing, [0, 0.04, -0.13]);
  add(new THREE.BoxGeometry(0.02, 0.24, 0.36), M.carbon, frontWing, [0.975, 0.1, 0]);
  add(new THREE.BoxGeometry(0.02, 0.24, 0.36), M.carbon, frontWing, [-0.975, 0.1, 0]);

  // Rear wing (flap angle follows the rear flap setting)
  const rearWing = new THREE.Group();
  rearWing.position.set(0, 1.14, 2.02);
  chassis.add(rearWing);
  add(new THREE.BoxGeometry(1.14, 0.03, 0.3), M.carbon, rearWing);
  add(new THREE.BoxGeometry(1.1, 0.03, 0.18), M.carbon, rearWing, [0, 0.07, -0.12]);
  add(new THREE.BoxGeometry(0.02, 0.4, 0.44), M.carbon, rearWing, [0.57, -0.06, 0]);
  add(new THREE.BoxGeometry(0.02, 0.4, 0.44), M.carbon, rearWing, [-0.57, -0.06, 0]);
  add(new THREE.BoxGeometry(0.05, 0.36, 0.12), M.carbon, chassis, [0.25, 0.8, 2.0]);
  add(new THREE.BoxGeometry(0.05, 0.36, 0.12), M.carbon, chassis, [-0.25, 0.8, 2.0]);

  // ---- wheels, suspension links (world space, driven by the telemetry each frame)
  const corners = {};
  const tyreGeo = new THREE.CylinderGeometry(TYRE_RADIUS, TYRE_RADIUS, 0.34, 40).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.35, 28).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.3, 0.16, 0.035);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const coil = new THREE.TubeGeometry(new HelixCurve(9), 180, 0.12, 8, false).translate(0, -0.5, 0);

  for (const c of CORNERS) {
    const sx = c[1] === 'l' ? -1 : 1;
    const zA = c[0] === 'f' ? -WHEELBASE / 2 : WHEELBASE / 2;
    const hub = new THREE.Group();
    scene.add(hub);
    const spin = new THREE.Group();
    hub.add(spin);
    const tyre = new THREE.Mesh(tyreGeo, M.tyre);
    tyre.castShadow = true;
    spin.add(tyre);
    spin.add(new THREE.Mesh(rimGeo, M.rim));
    for (let i = 0; i < 5; i++) {        // five spokes, rotate with the wheel
      const spoke = new THREE.Mesh(spokeGeo, M.rim);
      spoke.position.set(0, 0.1, 0);
      const holder = new THREE.Group();
      holder.rotation.x = (i * Math.PI * 2) / 5;
      holder.add(spoke);
      spin.add(holder);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.2, 36).rotateY(Math.PI / 2), ringMat);
    ring.position.x = sx * 0.178;
    hub.add(ring);

    const link = (mat) => { const m = new THREE.Mesh(unitCyl, mat); m.castShadow = true; scene.add(m); return m; };
    corners[c] = {
      c, sx, zA, hub, spin, ringMat,
      upper: link(M.steel), lower: link(M.steel), upright: link(M.steel), push: link(M.steel),
      spring: new THREE.Mesh(coil, M.spring), damper: link(M.damper),
    };
    scene.add(corners[c].spring);
    corners[c].spring.castShadow = true;
  }

  // ---- airflow particles (visual only, driven by speed; a fake potential-flow deflection)
  const N = 520;
  const pPos = new Float32Array(N * 3);
  const pCol = new Float32Array(N * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  points.visible = airflow;
  scene.add(points);
  for (let i = 0; i < N; i++) respawn(i, true);
  function respawn(i, initial) {
    pPos[i * 3] = (Math.random() - 0.5) * 3.4;
    pPos[i * 3 + 1] = 0.08 + Math.random() * 1.9;
    pPos[i * 3 + 2] = initial ? -4.6 + Math.random() * 9.2 : -4.6;
  }
  const teal = new THREE.Color('#2ee6c5'), amber = new THREE.Color('#ffb020');

  // ---- sizing
  const resize = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---- camera tween
  let goal = null;
  function setPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    goal = { pos: new THREE.Vector3(...p[0]), target: new THREE.Vector3(...p[1]) };
  }

  function setAccent(hex) {
    M.body.color.set(hex);
  }

  const DEG = Math.PI / 180;
  function update(f) {
    if (f) {
      const a = f.attitude;
      chassis.position.y = BASE_Y - (a.heaveMm / 1000) * VIS;
      chassis.rotation.set(-a.pitchDeg * DEG * VIS, 0, a.rollDeg * DEG * VIS);
      frontWing.rotation.x = -(0.04 + 0.22 * f.aero.wingFront);
      rearWing.rotation.x = -(0.05 + 0.7 * f.aero.wingRear) * 0.6;
      chassis.updateMatrixWorld(true);

      for (const c of CORNERS) {
        const k = corners[c];
        const hubY = TYRE_RADIUS + (f.roadMm[c] / 1000) * VIS;
        k.hub.position.set(k.sx * HALF_TRACK, hubY, k.zA);
        k.spin.rotation.x = -f.distanceM / TYRE_RADIUS;
        k.ringMat.color.set(tempHex(f.tyres[c].tempC));

        const upperOut = new THREE.Vector3(k.sx * 0.85, hubY + 0.16, k.zA);
        const lowerOut = new THREE.Vector3(k.sx * 0.85, hubY - 0.14, k.zA);
        const upIn = chassis.localToWorld(new THREE.Vector3(k.sx * 0.38, 0.66, k.zA));
        const loIn = chassis.localToWorld(new THREE.Vector3(k.sx * 0.38, 0.28, k.zA));
        const rk = chassis.localToWorld(new THREE.Vector3(k.sx * 0.22, 0.86, k.zA));
        const springLow = new THREE.Vector3().lerpVectors(loIn, lowerOut, 0.5);
        place(k.upper, upIn, upperOut, 0.016);
        place(k.lower, loIn, lowerOut, 0.02);
        place(k.upright, upperOut, lowerOut, 0.022);
        place(k.push, upperOut, rk, 0.01);
        // coilover: spring length tracks the chassis-to-lower-arm distance
        place(k.spring, rk, springLow, 0.05);
        place(k.damper, rk, springLow, 0.018);
      }
      // Wheel rotation is driven by distance travelled.
      points.visible = airflow;
      if (airflow) {
        const step = 0.02 + (f.speedKph / 300) * 0.09;
        for (let i = 0; i < N; i++) {
          pPos[i * 3 + 2] += step;
          if (pPos[i * 3 + 2] > 4.6) respawn(i, false);
          const x = pPos[i * 3], y = pPos[i * 3 + 1], z = pPos[i * 3 + 2];
          const qx = x / 0.9, qy = (y - 0.6) / 0.7, qz = z / 2.6;
          const g = Math.exp(-(qx * qx + qy * qy) * 0.8 - qz * qz * 0.2);
          pPos[i * 3] = x * (1 + 0.55 * g);
          pPos[i * 3 + 1] = 0.6 + (y - 0.6) * (1 + 0.45 * g);
          const col = _b.copy(teal).lerp(amber, Math.min(1, g * 1.4 * (f.speedKph / 280)));
          pCol[i * 3] = col.r; pCol[i * 3 + 1] = col.g; pCol[i * 3 + 2] = col.b;
        }
        pGeo.attributes.position.needsUpdate = true;
        pGeo.attributes.color.needsUpdate = true;
      }
    }
    if (goal) {
      camera.position.lerp(goal.pos, 0.12);
      orbit.target.lerp(goal.target, 0.12);
      if (camera.position.distanceTo(goal.pos) < 0.02) goal = null;
    }
    orbit.update();
    renderer.render(scene, camera);
  }

  function setAirflow(on) {
    points.visible = on;
  }

  function dispose() {
    ro.disconnect();
    orbit.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    renderer.dispose();
    renderer.domElement.remove();
  }

  // Initial pose so the car is visible before the first telemetry frame.
  update(null);
  return { update, setPreset, setAccent, setAirflow, dispose, resize, canvas: renderer.domElement };
}
