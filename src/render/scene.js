// Turns the level data and the simulation state into pixels.
//
// Nothing here changes game state. Each frame we read every anchor's world
// transform at the simulation time and copy it onto a mesh. Physics and
// rendering therefore always agree.

import * as THREE from 'three';
import { PALETTE, makeMaterials } from './materials.js';
import { mat4FromBasis, mat4Mul, mat4RotationAxis } from '../engine/math.js';
import { CAR } from '../engine/car.js';

// Shapes used for the car body (all in car-local space: origin at contact point).
const CAR_PARTS = [
  { kind: 'box', dims: [1.9, 0.6, 4.2], mat: 'carBody', local: translate(0, CAR.ride + 0.3, 0) },
  { kind: 'box', dims: [1.6, 0.55, 2.1], mat: 'carCabin', local: translate(0, CAR.ride + 0.85, -0.25) },
  ...[
    [-0.95, 1.35],
    [0.95, 1.35],
    [-0.95, -1.35],
    [0.95, -1.35],
  ].map(([x, z]) => ({
    kind: 'cyl',
    dims: [0.36, 0.28],
    mat: 'carWheel',
    local: mat4Mul(translate(x, 0.36, z), mat4RotationAxis([0, 0, 1], Math.PI / 2)),
  })),
];

function translate(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

// Geometry for an item, cached by shape so repeated pieces share buffers.
function makeGeometryFactory() {
  const cache = new Map();
  return (kind, dims) => {
    const key = `${kind}:${dims.map((v) => v.toFixed(3)).join(',')}`;
    let g = cache.get(key);
    if (g) return g;
    switch (kind) {
      case 'box':
        g = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
        break;
      case 'cyl':
        g = new THREE.CylinderGeometry(dims[0], dims[0], dims[1], 14);
        break;
      case 'cone':
        g = new THREE.CylinderGeometry(0, dims[0], dims[1], 5);
        break;
      case 'dodeca':
        g = new THREE.DodecahedronGeometry(dims[0], 0);
        break;
      case 'torus':
        g = new THREE.TorusGeometry(dims[0], dims[1], 8, 32);
        break;
      case 'plane':
        g = new THREE.PlaneGeometry(dims[0], dims[1]);
        break;
      default:
        throw new Error(`No geometry for kind ${kind}`);
    }
    cache.set(key, g);
    return g;
  };
}

export function createSceneView(level, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 380, 1800);

  const hemi = new THREE.HemisphereLight('#e8edf3', '#4a4e55', 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 2.1);
  sun.position.set(-160, 320, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -130;
  sc.right = 130;
  sc.top = 130;
  sc.bottom = -130;
  sc.near = 10;
  sc.far = 800;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  const mats = makeMaterials();
  const geometry = makeGeometryFactory();

  // Every level item becomes a mesh whose matrix is driven by its anchor.
  const itemMeshes = level.items.map((item) => {
    const mesh = new THREE.Mesh(geometry(item.kind, item.dims), mats[item.mat] ?? mats.wall);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = item.cast && item.mat !== 'portal' && item.mat !== 'portalExit';
    mesh.receiveShadow = true;
    if (item.mat === 'portal' || item.mat === 'portalExit') mesh.renderOrder = 5;
    scene.add(mesh);
    return { item, mesh };
  });

  // The car.
  const carMeshes = CAR_PARTS.map((p) => {
    const mesh = new THREE.Mesh(geometry(p.kind, p.dims), mats[p.mat]);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return { part: p, mesh };
  });

  // Debug: route centrelines and wheel contacts.
  const debug = new THREE.Group();
  debug.visible = false;
  scene.add(debug);
  for (const zone of level.parts) {
    const pts = zone.route.pts.map((p) => new THREE.Vector3(p[0], p[1] + 0.1, p[2]));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    debug.add(new THREE.Line(geo, mats.debugRoute));
  }
  const probeGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const probes = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(probeGeo, mats.debugProbe);
    m.matrixAutoUpdate = false;
    debug.add(m);
    return m;
  });

  // Dust: a few hundred specks drifting around the car so the height reads.
  const dustCount = 900;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 400;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 160;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 400;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: '#ffffff', size: 0.28, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }),
  );
  scene.add(dust);

  // Camera: chase by default, cockpit with C, overview with ?overview.
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000);
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let mode = 'chase';
  let snap = true;
  let overview = null;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function syncItems(t) {
    for (const { item, mesh } of itemMeshes) {
      const m = item.anchor.world(t);
      mesh.matrix.fromArray(m);
      mesh.matrixWorld.fromArray(m);
    }
  }

  function syncCar(car) {
    const { F, R, N } = car.frame;
    const p = car.pos;
    const base = mat4FromBasis([p[0], p[1], p[2]], R, N, F);
    for (const { part, mesh } of carMeshes) {
      const m = mat4Mul(base, part.local);
      mesh.matrix.fromArray(m);
      mesh.matrixWorld.fromArray(m);
    }
  }

  function updateCamera(car, dt) {
    const { F, N } = car.frame;
    const p = car.pos;
    let wantPos;
    let wantLook;
    if (overview) {
      wantPos = overview.pos;
      wantLook = overview.look;
    } else if (mode === 'cockpit') {
      wantPos = [p[0] + N[0] * 1.5 + F[0] * 0.2, p[1] + N[1] * 1.5 + 0.3, p[2] + N[2] * 1.5 + F[2] * 0.2];
      wantLook = [p[0] + F[0] * 30, p[1] + 1 + F[1] * 30, p[2] + F[2] * 30];
    } else {
      wantPos = [p[0] - F[0] * 10.5, p[1] + 4.2, p[2] - F[2] * 10.5];
      wantLook = [p[0] + F[0] * 6, p[1] + 1.2, p[2] + F[2] * 6];
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * (mode === 'cockpit' ? 14 : 6));
    const dx = wantPos[0] - camPos.x;
    const dy = wantPos[1] - camPos.y;
    const dz = wantPos[2] - camPos.z;
    if (snap || dx * dx + dy * dy + dz * dz > 900) {
      camPos.set(wantPos[0], wantPos[1], wantPos[2]);
      camLook.set(wantLook[0], wantLook[1], wantLook[2]);
      snap = false;
    } else {
      camPos.x += dx * k;
      camPos.y += dy * k;
      camPos.z += dz * k;
      camLook.x += (wantLook[0] - camLook.x) * k;
      camLook.y += (wantLook[1] - camLook.y) * k;
      camLook.z += (wantLook[2] - camLook.z) * k;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.updateMatrixWorld();

    // Keep the shadow frustum around the car.
    sun.position.set(p[0] - 160, p[1] + 320, p[2] + 120);
    sun.target.position.set(p[0], p[1], p[2]);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  return {
    renderer,
    scene,
    camera,
    mats,
    setCameraMode(m) {
      mode = m;
    },
    get cameraMode() {
      return mode;
    },
    setOverview(on) {
      overview = on
        ? {
            pos: [(level.bounds.minX + level.bounds.maxX) / 2, 900, (level.bounds.minZ + level.bounds.maxZ) / 2 + 700],
            look: [(level.bounds.minX + level.bounds.maxX) / 2, 0, (level.bounds.minZ + level.bounds.maxZ) / 2],
          }
        : null;
    },
    get overview() {
      return overview;
    },
    setDebug(on) {
      debug.visible = on;
    },
    get debug() {
      return debug.visible;
    },
    update(world, dt) {
      const t = world.t;
      syncItems(t);
      syncCar(world.car);
      // Wheel probe markers (debug only).
      if (debug.visible) {
        const { F, R } = world.car.frame;
        const p = world.car.pos;
        const offs = [
          [-CAR.wheelX, CAR.wheelZ],
          [CAR.wheelX, CAR.wheelZ],
          [-CAR.wheelX, -CAR.wheelZ],
          [CAR.wheelX, -CAR.wheelZ],
        ];
        offs.forEach(([wx, wz], i) => {
          const q = [0, 1, 2].map((k) => p[k] + R[k] * wx + F[k] * wz);
          probes[i].matrix.fromArray(translate(q[0], q[1], q[2]));
          probes[i].matrixWorld.fromArray(probes[i].matrix.elements);
        });
      }
      // Membranes shimmer very slightly.
      mats.portal.opacity = 0.38 + 0.06 * Math.sin(t * 2.2);
      // Dust follows the car.
      const p = world.car.pos;
      dust.position.set(p[0], p[1], p[2]);
      dust.updateMatrixWorld();
      updateCamera(world.car, dt);
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}
