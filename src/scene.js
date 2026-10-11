import { heightOf, roadElevation, isElevated } from "./road-elevation.js";
import { roadStationAt } from "./road-decks.js";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildNetwork,
  triangulate,
  fromPath,
  distance,
  nearestRoad,
  difference,
  intersectionPaths,
} from "./network.js";
import { atStation, preparePath } from "./alignment.js";
import { TrafficSimulation } from "./traffic.js";
import { humpMesh, humpSpec } from "./traffic-calming.js";
import {
  buildStreetscape,
  pavementHeight,
  rampHeight,
  rampPoint,
  localPoint,
  frameAt,
  pathOf,
  containsPoint,
} from "./streetscape.js";
import { pavingCanvases } from "./paving.js";
import { localMesh } from "./local-mesh.js";
import { bridgeGeometry, closestConnection } from "./connections.js";
import { slabShell } from "./slab-shell.js";
import { createFreeCamera } from "./free-camera.js";
export async function createScene(host, onSelect, onMove, onDraw) {
  let renderer,
    backend = "WebGL2 fallback";
  try {
    if (
      new URLSearchParams(location.search).get("renderer") === "webgl" ||
      !navigator.gpu
    )
      throw Error("WebGPU unavailable");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw Error("WebGPU unavailable");
    const device = await adapter.requestDevice();
    const { WebGPURenderer } = await import("three/webgpu");
    renderer = new WebGPURenderer({ antialias: true, device });
    await renderer.init();
    backend = "WebGPU";
    renderer.onDeviceLost = (info) => {
      backend = "WebGPU device lost";
      renderer.setAnimationLoop(null);
      window.dispatchEvent(
        new CustomEvent("slate-device-lost", { detail: info.message }),
      );
    };
  } catch {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#b2bab5");
  scene.fog = new THREE.Fog("#b2bab5", 650, 1300);
  const camera = new THREE.PerspectiveCamera(37, 1, 2, 1800);
  camera.position.set(222, 255, 268);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(5, 0, -5);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI - 0.01;
  controls.minDistance = 0.25;
  controls.maxDistance = 900;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  const fly = createFreeCamera(
    camera,
    controls,
    renderer.domElement,
    (state) => {
      const badge = host.querySelector("#fly-status");
      if (badge) {
        badge.textContent = state.active
          ? `FLY · ${state.speed.toFixed(1)} m/s · SHIFT ×4`
          : "RMB + WASD · Fly";
        badge.classList.toggle("flying", state.active);
      }
      if (!state.active) controls.enabled = mode !== "draw";
    },
  );
  scene.add(new THREE.HemisphereLight("#e5efff", "#70745c", 2.6));
  const sun = new THREE.DirectionalLight("#fff0d3", 3.1);
  sun.position.set(-100, 180, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -250,
    right: 250,
    top: 220,
    bottom: -220,
    near: 1,
    far: 650,
  });
  sun.shadow.normalBias = 0.12;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);
  const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.86, ...opts });
  let seed = 421;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function texture(type) {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d");
    ctx.fillStyle =
      type === "asphalt" ? "#999999" : type === "grass" ? "#a4ac92" : "#b8b7ae";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40000; i++) {
      const v = Math.floor(75 + rand() * 125);
      ctx.fillStyle =
        type === "grass"
          ? `rgba(${v - 20},${v},${v - 35},.13)`
          : `rgba(${v},${v},${v},.24)`;
      ctx.fillRect(rand() * 512, rand() * 512, rand() * 2 + 1, rand() * 2 + 1);
    }
    if (type === "paving") {
      ctx.strokeStyle = "#92938e";
      ctx.lineWidth = 2;
      for (let y = 0; y < 512; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y);
        ctx.stroke();
        for (let x = ((y / 64) % 2) * 64; x < 512; x += 128) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 64);
          ctx.stroke();
        }
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  const asphalt = mat("#353b40", { map: texture("asphalt") }),
    paving = mat("#b6b6ae", { map: texture("paving") }),
    grass = mat("#87917e", { map: texture("grass") }),
    concrete = mat("#c0beb4"),
    paint = mat("#e9e6d7", {
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
    yellow = mat("#d3ad50"),
    metal = mat("#4b5357", { metalness: 0.65, roughness: 0.4 }),
    black = mat("#171c21"),
    glass = mat("#405660", { metalness: 0.45, roughness: 0.16 });
  const tactile = mat("#c7a769", { roughness: 0.96 }),
    iron = mat("#393d3e", { metalness: 0.75, roughness: 0.68 }),
    well = mat("#171d20");
  const pavingTextures = new Map();
  function updatePaving(m) {
    const pattern = m.materials.paving;
    if (!pavingTextures.has(pattern)) {
      const c = pavingCanvases(pattern),
        map = new THREE.CanvasTexture(c.color),
        bump = new THREE.CanvasTexture(c.height);
      map.colorSpace = THREE.SRGBColorSpace;
      for (const t of [map, bump]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        t.center.set(0.5, 0.5);
      }
      pavingTextures.set(pattern, { map, bump });
    }
    const { map, bump } = pavingTextures.get(pattern);
    const scale = m.materials.pavingScale || 1,
      rotation = ((m.materials.pavingRotation || 0) * Math.PI) / 180;
    for (const t of [map, bump]) {
      t.repeat.set(5 / (1.2 * scale), 5 / (1.2 * scale));
      t.rotation = rotation;
    }
    paving.map = map;
    paving.bumpMap = bump;
    paving.bumpScale = 0.004;
    paving.color.set(m.materials.pavingColor || "#c9c5ba");
    paving.needsUpdate = true;
  }
  grass.map.repeat.set(55, 55);
  const bark = mat("#736855"),
    leaves = ["#687859", "#778765", "#5f7458"].map((c) => mat(c));
  const ground = new THREE.Mesh(new THREE.BoxGeometry(460, 3, 365), grass);
  ground.position.y = -1.7;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(460, 46, "#84928c", "#909e96");
  grid.position.y = -0.14;
  grid.visible = false;
  scene.add(grid);
  const groups = {};
  [
    "roads",
    "sidewalks",
    "curbs",
    "markings",
    "landscape",
    "lights",
    "bollards",
    "traffic",
    "calming",
    "crossings",
    "ramps",
    "drainage",
    "manholes",
    "selection",
    "draft",
    "bridges",
    "parkland",
  ].forEach((k) => {
    groups[k] = new THREE.Group();
    scene.add(groups[k]);
  });
  let model,
    data,
    selected = null,
    mode = "select",
    paused = false,
    wire = false,
    street,
    tactileDomes = null,
    carStates = [],
    simulation,
    bridgeResults = [];
  const parkGrass = grass.clone();
  parkGrass.map = grass.map.clone();
  parkGrass.map.repeat.set(0.6, 0.6);
  const shared = new Set([
    parkGrass,
    tactile,
    iron,
    well,
    asphalt,
    paving,
    grass,
    concrete,
    paint,
    yellow,
    metal,
    black,
    glass,
    bark,
    ...leaves,
  ]);
  function clear(group) {
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose();
      if (o.material && !shared.has(o.material)) o.material.dispose?.();
    });
    group.clear();
  }
  function mesh(geometry, material, group) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = group !== groups.markings;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function flat(paths, height, material, group) {
    const d = localMesh(
        paths,
        height,
        material === parkGrass
          ? Math.max(
              12,
              Math.ceil(
                Math.max(ground.scale.x * 460, ground.scale.z * 365) / 48,
              ),
            )
          : 6,
      ),
      geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(d.positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(d.uvs, 2));
    geo.setIndex(d.indices);
    geo.computeVertexNormals();
    const result = mesh(geo, material, group);
    result.castShadow = false;
    return result;
  }
  function generated(d, material, group) {
    if (!d.positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(d.positions, 3),
    );
    geo.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        d.uvs || d.positions.filter((_, i) => i % 3 !== 1),
        2,
      ),
    );
    geo.setIndex(d.indices);
    geo.computeVertexNormals();
    const m = mesh(geo, material, group);
    m.castShadow = false;
    return m;
  }
  function box(w, h, d, x, y, z, material, group, rotation = 0) {
    const m = mesh(new THREE.BoxGeometry(w, h, d), material, group);
    m.position.set(x, y, z);
    m.rotation.y = rotation;
    return m;
  }
  function cylinder(r1, r2, h, x, y, z, material, group, segments = 12) {
    const m = mesh(
      new THREE.CylinderGeometry(r1, r2, h, segments),
      material,
      group,
    );
    m.position.set(x, y, z);
    return m;
  }
  const station = atStation;
  const roadLength = (p) => p.lengthMeters ?? preparePath(p).lengthMeters;
  function junctionNear(x, z, road, margin = 0) {
    return model.nodes.some(
      (n) =>
        model.roads.filter((r) => r.a === n.id || r.b === n.id).length > 2 &&
        Math.hypot(n.x - x, n.z - z) <
          Math.max(
            ...model.roads
              .filter((r) => r.a === n.id || r.b === n.id)
              .map((r) => r.width),
          ) /
            2 +
            model.radius +
            margin,
    );
  }
  function mark(p, offset, width, length, material = paint) {
    box(
      width,
      0.003,
      length,
      p.x - p.dz * offset,
      0.1215,
      p.z + p.dx * offset,
      material,
      groups.markings,
      Math.atan2(p.dx, p.dz),
    );
  }
  function markingStrip(road, start, end, lateral, width) {
    if (end - start < 0.02) return;
    const positions = [],
      uvs = [],
      indices = [],
      count = Math.max(1, Math.ceil((end - start) / 0.25));
    for (let i = 0; i <= count; i++) {
      const s = start + ((end - start) * i) / count,
        p = station(road.samples, s),
        w =
          road.samples.widths[p.index] * (1 - p.t) +
          road.samples.widths[Math.min(p.index + 1, road.samples.length - 1)] *
            p.t,
        offset = lateral(w);
      for (const edge of [-1, 1]) {
        const o = offset + (edge * width) / 2;
        positions.push(
          p.x - p.dz * o,
          0.123 + roadElevation(road, model, s),
          p.z + p.dx * o,
        );
        uvs.push(s, edge);
      }
      if (i) {
        const k = (i - 1) * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    mesh(geo, paint, groups.markings);
  }
  function buildMarkings() {
    for (const r of data.sampled) {
      if (r.surface === "concrete") continue;
      const len = roadLength(r.samples),
        hump = humpSpec(r, model);
      for (let s = 2; s < len; s += 6) {
        const p = station(r.samples, s + 1.5);
        if (
          !junctionNear(p.x, p.z, r, 3) &&
          (!hump || Math.abs(s + 1.5 - hump.center) > hump.length / 2 + 1.5)
        ) {
          markingStrip(r, s, Math.min(s + 3, len), () => 0, 0.13);
          if (r.width >= 13)
            for (const side of [-1, 1])
              markingStrip(
                r,
                s,
                Math.min(s + 3, len),
                (w) => (side * w) / 4,
                0.12,
              );
        }
      }
      let start = null;
      for (let s = 0; s <= len + 0.5; s += 0.5) {
        const p = station(r.samples, Math.min(s, len)),
          allowed = s <= len && !junctionNear(p.x, p.z, r, 1);
        if (allowed && start === null) start = s;
        if (!allowed && start !== null) {
          for (const side of [-1, 1])
            markingStrip(
              r,
              start,
              Math.min(s, len),
              (w) =>
                side * (w / 2 - (model.layers.drainage === false ? 0.32 : 0.6)),
              0.1,
            );
          start = null;
        }
      }
    }
    for (const crossing of street.crossings) {
      const { p, length, reverse, s } = crossing;
      for (let x = -p.width / 2 + 0.65; x < p.width / 2 - 0.3; x += 1.1) {
        const stripe = box(
          0.5,
          0.003,
          length,
          p.x - p.dz * x,
          0.1215,
          p.z + p.dx * x,
          paint,
          groups.crossings,
          Math.atan2(p.dx, p.dz),
        );
        stripe.castShadow = false;
      }
      const road = data.sampled.find((r) => r.id === crossing.road),
        q = station(road.samples, s + (reverse ? -1 : 1) * (length / 2 + 1.2));
      mark(q, ((reverse ? -1 : 1) * p.width) / 4, p.width / 2 - 0.55, 0.28);
    }
  }
  function lamp(x, z, angle) {
    cylinder(0.065, 0.13, 7.2, x, 3.8, z, metal, groups.lights);
    cylinder(0.22, 0.25, 0.35, x, 0.42, z, metal, groups.lights);
    const dx = Math.sin(angle),
      dz = Math.cos(angle);
    box(
      0.1,
      0.1,
      1.7,
      x + dx * 0.75,
      7.35,
      z + dz * 0.75,
      metal,
      groups.lights,
      angle,
    );
    box(
      0.36,
      0.12,
      0.86,
      x + dx * 1.45,
      7.29,
      z + dz * 1.45,
      metal,
      groups.lights,
      angle,
    );
    box(
      0.27,
      0.03,
      0.65,
      x + dx * 1.45,
      7.215,
      z + dz * 1.45,
      paint,
      groups.lights,
      angle,
    );
  }
  function tree(x, z, h) {
    cylinder(0.12, 0.22, h * 0.48, x, h * 0.24, z, bark, groups.landscape);
    for (let i = 0; i < 3; i++) {
      const m = mesh(
        new THREE.SphereGeometry(h * (0.24 - i * 0.027), 20, 16),
        leaves[i],
        groups.landscape,
      );
      m.position.set(
        x + (rand() - 0.5),
        h * (0.62 + i * 0.1),
        z + (rand() - 0.5),
      );
      m.scale.y = 1.1;
    }
  }
  function detail() {
    seed = 421;
    const links = (model.connections || []).filter((c) =>
      c.kind === "bridge"
        ? bridgeResults.some((b) => b.id === c.id && b.valid)
        : model.layers.walkways !== false,
    );
    for (const r of data.groundSampled || data.sampled) {
      const len = roadLength(r.samples);
      for (let s = 15; s < len - 12; s += 29) {
        const p = station(r.samples, s);
        if (
          street.driveways.some(
            (d) =>
              d.roadId === r.id && Math.abs(d.s - s) < d.half + d.flare + 1,
          ) ||
          junctionNear(p.x, p.z, r, 5) ||
          street.crossings.some(
            (c) => c.road === r.id && Math.abs(c.s - s) < c.length / 2 + 2,
          )
        )
          continue;
        for (const side of [-1, 1]) {
          const off = side * (r.width / 2 + model.sidewalk * 0.65),
            x = p.x - p.dz * off,
            z = p.z + p.dx * off;
          if (
            closestConnection(
              [x, z],
              links.map((c) => ({ ...c, width: c.width + 3 })),
            )
          )
            continue;
          if (
            (data.structures || []).some((part) =>
              containsPoint(part.paths, x, z),
            )
          )
            continue;
          lamp(x, z, Math.atan2(p.dz * side, -p.dx * side));
          if (model.layers.bollards)
            cylinder(
              0.065,
              0.09,
              0.9,
              x + p.dx * 2.4,
              0.72,
              z + p.dz * 2.4,
              metal,
              groups.bollards,
              16,
            );
        }
      }
    }
    for (let x = -155; x < 165; x += 15)
      for (let z = -120; z < 110; z += 16) {
        const p = [x + (rand() - 0.5) * 7, z + (rand() - 0.5) * 7],
          near = nearestRoad(p, { ...model, roads: data.sampled });
        if (
          near &&
          !closestConnection(
            p,
            links.map((c) => ({ ...c, width: c.width + 8 })),
          ) &&
          near.distance > near.road.width / 2 + model.sidewalk + 6 &&
          rand() > 0.5
        )
          tree(...p, 5 + rand() * 3);
      }
  }
  function car(color) {
    const g = new THREE.Group(),
      body = mat(color, { metalness: 0.48, roughness: 0.28 });
    const shell = mesh(
      new RoundedBoxGeometry(1.78, 0.55, 4.25, 4, 0.15),
      body,
      g,
    );
    shell.position.set(0, 0.72, 0);
    const cabin = box(1.52, 0.6, 2.02, 0, 1.2, -0.18, glass, g);
    box(1.48, 0.09, 1.2, 0, 1.55, -0.26, body, g);
    box(1.62, 0.1, 0.7, 0, 0.97, 1.62, body, g);
    box(1.6, 0.12, 0.15, 0, 0.56, 2.13, metal, g);
    for (const side of [-1, 1])
      for (const z of [-1.27, 1.28]) {
        const wheel = cylinder(
          0.33,
          0.33,
          0.2,
          side * 0.87,
          0.48,
          z,
          black,
          g,
          20,
        );
        wheel.rotation.z = Math.PI / 2;
        const hub = cylinder(
          0.18,
          0.18,
          0.205,
          side * 0.88,
          0.48,
          z,
          metal,
          g,
          16,
        );
        hub.rotation.z = Math.PI / 2;
      }
    for (const side of [-1, 1]) {
      box(0.42, 0.11, 0.07, side * 0.57, 0.83, 2.14, paint, g);
      box(0.4, 0.12, 0.07, side * 0.57, 0.83, -2.14, mat("#9e3b31"), g);
      box(0.16, 0.12, 0.27, side * 0.88, 1.16, 0.48, body, g);
    }
    return g;
  }
  function traffic() {
    simulation = new TrafficSimulation(data, model, rand);
    carStates = simulation.spawn(model.traffic);
    const colors = [
      "#c4c7c5",
      "#304b5d",
      "#a56643",
      "#b6bab7",
      "#293b42",
      "#e2ded3",
    ];
    for (const state of carStates) {
      state.g = car(colors[state.id % colors.length]);
      groups.traffic.add(state.g);
    }
  }
  function calming() {
    for (const road of data.sampled) {
      const d = humpMesh(road, model);
      if (!d) continue;
      for (const positions of [d.positions, d.paintPositions])
        for (let i = 0; i < positions.length; i += 3)
          positions[i + 1] += roadElevation(
            road,
            model,
            roadStationAt(road, positions[i], positions[i + 2]),
          );
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(d.positions, 3),
      );
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(d.uvs, 2));
      geo.setIndex(d.indices);
      geo.computeVertexNormals();
      mesh(geo, asphalt, groups.calming);
      const markings = new THREE.BufferGeometry();
      markings.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(d.paintPositions, 3),
      );
      markings.setIndex(d.paintIndices);
      markings.computeVertexNormals();
      const m = mesh(markings, paint, groups.calming);
      m.castShadow = false;
    }
  }
  function streetFurniture() {
    tactileDomes = null;
    generated(street.gutterMesh, concrete, groups.drainage);
    for (const grate of street.grates) {
      const p = grate.p,
        a = Math.atan2(p.dx, p.dz);
      box(0.32, 0.035, 0.9, p.x, -0.1, p.z, well, groups.drainage, a);
      // Recess walls and a flush perimeter frame surround actual open slots.
      for (const side of [-1, 1]) {
        let q = localPoint(p, 0, side * 0.148);
        box(0.024, 0.23, 0.9, q[0], 0.005, q[1], iron, groups.drainage, a);
        q = localPoint(p, side * 0.438, 0);
        box(0.296, 0.23, 0.024, q[0], 0.005, q[1], iron, groups.drainage, a);
      }
      const slats = 25,
        bar = 0.022,
        gap = (0.852 - slats * bar) / (slats + 1);
      for (let i = 0; i < slats; i++) {
        const u = -0.426 + gap + bar / 2 + i * (bar + gap),
          q = localPoint(p, u, 0);
        box(0.276, 0.025, bar, q[0], 0.1075, q[1], iron, groups.drainage, a);
      }
    }
    for (const cover of street.manholes) {
      const { x, z, radius: r } = cover,
        inner = r - 0.055,
        paths = [
          pathOf(
            Array.from({ length: 64 }, (_, i) => [
              x + Math.cos((i * Math.PI) / 32) * r,
              z + Math.sin((i * Math.PI) / 32) * r,
            ]),
          ),
          pathOf(
            Array.from({ length: 64 }, (_, i) => [
              x + Math.cos((i * Math.PI) / 32) * inner,
              z + Math.sin((i * Math.PI) / 32) * inner,
            ]),
          ).reverse(),
        ];
      flat(paths, 0.12, iron, groups.manholes);
      cylinder(inner, inner, 0.02, x, 0.055, z, well, groups.manholes, 64);
      cylinder(
        inner - 0.004,
        inner - 0.004,
        0.045,
        x,
        0.0945,
        z,
        iron,
        groups.manholes,
        64,
      );
      const ring = mesh(
        new THREE.TorusGeometry(r - 0.027, 0.002, 6, 64),
        metal,
        groups.manholes,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.118, z);
      for (let v = -inner + 0.03; v < inner - 0.02; v += 0.045) {
        const half = Math.sqrt(Math.max(0, (inner - 0.015) ** 2 - v * v));
        box(half * 2, 0.003, 0.007, x, 0.1185, z + v, metal, groups.manholes);
      }
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        cylinder(
          0.009,
          0.009,
          0.004,
          x + Math.cos(a) * (r - 0.027),
          0.118,
          z + Math.sin(a) * (r - 0.027),
          metal,
          groups.manholes,
          6,
        );
      }
      for (const sign of [-1, 1])
        box(
          0.052,
          0.002,
          0.016,
          x + sign * inner * 0.55,
          0.118,
          z,
          well,
          groups.manholes,
        );
    }
    generated(street.tactileMesh, tactile, groups.ramps);
    const positions = [],
      normals = [];
    for (const t of street.tactiles) {
      const r = t.ramp;
      for (let u = -r.half + 0.25; u < r.half - 0.22; u += 0.06)
        for (let v = 0.4; v < 0.92; v += 0.06) {
          const q = rampPoint(r, u, v);
          if (!containsPoint(t.paths, ...q)) continue;
          positions.push(
            new THREE.Vector3(q[0], rampHeight(r, ...q) + 0.0025, q[1]),
          );
          normals.push(
            r.kind === "parallel"
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(
                  (r.side * r.p.dz * 0.15) / r.run,
                  1,
                  (-r.side * r.p.dx * 0.15) / r.run,
                ).normalize(),
          );
        }
    }
    if (positions.length) {
      const domes = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.009, 0.0125, 0.005, 8),
          tactile,
          positions.length,
        ),
        matrix = new THREE.Matrix4(),
        quaternion = new THREE.Quaternion(),
        up = new THREE.Vector3(0, 1, 0);
      positions.forEach((p, i) => {
        quaternion.setFromUnitVectors(up, normals[i]);
        matrix.compose(p, quaternion, new THREE.Vector3(1, 1, 1));
        domes.setMatrixAt(i, matrix);
      });
      domes.receiveShadow = true;
      tactileDomes = domes;
      groups.ramps.add(domes);
    }
  }
  function batch(group) {
    const buckets = new Map();
    group.updateMatrixWorld(true);
    for (const child of [...group.children]) {
      if (!child.isMesh) continue;
      const geometry = child.geometry.clone().applyMatrix4(child.matrix);
      if (!buckets.has(child.material)) buckets.set(child.material, []);
      buckets.get(child.material).push(geometry);
      child.geometry.dispose();
      group.remove(child);
    }
    for (const [material, geometries] of buckets) {
      const merged = mergeGeometries(geometries);
      geometries.forEach((g) => g.dispose());
      if (merged) mesh(merged, material, group);
    }
  }
  function buildRoadDecks() {
    for (const part of data.structures || []) {
      const group = new THREE.Group();
      group.userData[part.kind === "road" ? "roadId" : "nodeId"] = part.id;
      groups.bridges.add(group);
      generated(
        part.top,
        part.surface === "concrete" ? concrete : asphalt,
        group,
      );
      generated(part.shell, concrete, group);
      const incident =
        part.kind === "road"
          ? data.sampled.filter((r) => r.id === part.id)
          : data.sampled.filter((r) => r.a === part.id || r.b === part.id);
      const beam = (a, b) => {
        const d = new THREE.Vector3().subVectors(b, a);
        if (d.length() < 0.02) return;
        const m = mesh(
          new THREE.BoxGeometry(0.1, 0.14, d.length()),
          metal,
          group,
        );
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          d.normalize(),
        );
      };
      for (const path of part.paths) {
        let postRemaining = 0;
        const pts = fromPath(path);
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i],
            b = pts[(i + 1) % pts.length],
            mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          // The cut across a shared junction mouth is NOT an exposed deck edge.
          if (
            incident.some((r) => {
              const t = roadStationAt(r, ...mid),
                p = atStation(r.samples, t),
                w = r.samples.widths[p.index];
              return Math.hypot(p.x - mid[0], p.z - mid[1]) < w / 2 - 0.06;
            })
          )
            continue;
          const h = (p) =>
            part.kind === "junction"
              ? 0.12 + heightOf(model.nodes.find((n) => n.id === part.id))
              : 0.12 +
                roadElevation(
                  incident[0],
                  model,
                  roadStationAt(incident[0], ...p),
                );
          for (const rail of [0.6, 1.1])
            beam(
              new THREE.Vector3(a[0], h(a) + rail, a[1]),
              new THREE.Vector3(b[0], h(b) + rail, b[1]),
            );
          const len = distance(a, b);
          let t = postRemaining;
          for (; t < len; t += 2.5) {
            const p = [
              a[0] + ((b[0] - a[0]) * t) / len,
              a[1] + ((b[1] - a[1]) * t) / len,
            ];
            box(0.1, 1.15, 0.1, p[0], h(p) + 0.575, p[1], metal, group);
          }
          postRemaining = t - len;
        }
      }
      if (part.kind === "road") {
        const r = incident[0];
        for (let t = 18; t < r.samples.lengthMeters - 12; t += 28) {
          const p = atStation(r.samples, t),
            height = roadElevation(r, model, t) - 0.52;
          if (height < 1) continue;
          // Do not place a concept support in a carriageway below the deck.
          const blocked = data.sampled.some(
            (other) =>
              other.id !== r.id &&
              (() => {
                const s = roadStationAt(other, p.x, p.z),
                  q = atStation(other.samples, s);
                return (
                  Math.hypot(q.x - p.x, q.z - p.z) <
                    other.width / 2 + model.sidewalk + 1 &&
                  roadElevation(other, model, s) < height
                );
              })(),
          );
          if (!blocked)
            box(1.1, height, 1.1, p.x, 0.24 + height / 2, p.z, concrete, group);
        }
      }
      batch(group);
    }
  }
  function buildBridges() {
    bridgeResults = [];
    if (model.layers.bridges === false) return;
    for (const c of model.connections || []) {
      if (c.kind !== "bridge") continue;
      const d = bridgeGeometry(c, data);
      bridgeResults.push({ id: c.id, ...d });
      if (!d.valid) continue;
      const group = new THREE.Group();
      group.userData.connectionId = c.id;
      groups.bridges.add(group);
      generated(d, concrete, group);
      const beam = (a, b, r = 0.045) => {
        const direction = new THREE.Vector3().subVectors(b, a),
          m = mesh(
            new THREE.CylinderGeometry(r, r, direction.length(), 8),
            metal,
            group,
          );
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        );
      };
      const railPoint = (p, side, h) =>
        new THREE.Vector3(
          p.x - p.dz * side * (c.width / 2 + 0.09),
          p.y + h,
          p.z + p.dx * side * (c.width / 2 + 0.09),
        );
      for (const side of [-1, 1]) {
        for (let i = 1; i < d.frames.length; i++)
          for (const h of [0.65, 1.25])
            beam(
              railPoint(d.frames[i - 1], side, h),
              railPoint(d.frames[i], side, h),
            );
        let last = -Infinity;
        for (const p of d.frames) {
          if (p.s - last < 2.4 && p !== d.frames.at(-1)) continue;
          beam(railPoint(p, side, 0), railPoint(p, side, 1.3), 0.055);
          last = p.s;
        }
      }
      const supports = [d.start, d.end];
      for (let s = 12; s < d.length - 8; s += 12)
        if (supports.every((v) => Math.abs(v - s) > 3)) supports.push(s);
      for (const s of supports) {
        const p = d.frames.reduce((best, p) =>
          Math.abs(p.s - s) < Math.abs(best.s - s) ? p : best,
        );
        if (p.y < 1.1 || containsPoint(data.walkOuter, p.x, p.z)) continue;
        for (const side of [-1, 1]) {
          const x = p.x - p.dz * side * c.width * 0.32,
            z = p.z + p.dx * side * c.width * 0.32;
          if (
            [-0.55, 0.55].some((dx) =>
              [-0.55, 0.55].some((dz) =>
                containsPoint(data.walkOuter, x + dx, z + dz),
              ),
            )
          )
            continue;
          cylinder(
            0.28,
            0.34,
            p.y - 0.59,
            x,
            (p.y - 0.35 + 0.24) / 2,
            z,
            concrete,
            group,
            16,
          );
          box(1, 0.25, 1, x, 0.2, z, concrete, group);
        }
      }
      batch(group);
    }
  }
  function rebuild(m) {
    model = m;
    data = buildNetwork(m);
    street = buildStreetscape(m, {
      ...data,
      sampled: data.groundSampled || data.sampled,
    });
    data.mesh = triangulate(street.asphalt, 0.12);
    Object.values(groups).forEach(clear);
    asphalt.color.set(m.materials.asphalt);
    asphalt.roughness = m.materials.roughness;
    asphalt.wireframe = wire;
    updatePaving(m);
    flat(
      difference(street.asphalt, data.concreteSurface),
      0.12,
      asphalt,
      groups.roads,
    );
    flat(
      intersectionPaths(street.asphalt, data.concreteSurface),
      0.12,
      concrete,
      groups.roads,
    );
    const allPoints = [
      ...model.nodes.map((n) => [n.x, n.z]),
      ...(model.connections || []).flatMap((c) => c.points),
    ];
    const xs = allPoints.map((p) => p[0]),
      zs = allPoints.map((p) => p[1]),
      minX = Math.min(-230, ...xs) - 20,
      maxX = Math.max(230, ...xs) + 20,
      minZ = Math.min(-182.5, ...zs) - 20,
      maxZ = Math.max(182.5, ...zs) + 20;
    ground.scale.set((maxX - minX) / 460, 1, (maxZ - minZ) / 365);
    ground.position.set((minX + maxX) / 2, -1.7, (minZ + maxZ) / 2);
    flat(
      difference(
        [
          pathOf([
            [minX, minZ],
            [maxX, minZ],
            [maxX, maxZ],
            [minX, maxZ],
          ]),
        ],
        [...data.walkOuter, ...(data.groundMask || [])],
      ),
      0.24,
      parkGrass,
      groups.parkland,
    );
    buildRoadDecks();
    buildBridges();
    flat(street.walk, 0.27, paving, groups.sidewalks);
    flat(street.curb, 0.27, concrete, groups.curbs);
    generated(street.walkRamp, paving, groups.sidewalks);
    generated(street.curbRamp, concrete, groups.curbs);
    streetFurniture();
    // Material contours have the correct outer and inner boundary winding.
    generated(
      slabShell(
        data.curb,
        (x, z) => pavementHeight(street, x, z),
        -0.2,
        0.15,
        street.curbRamp.positions,
      ),
      concrete,
      groups.curbs,
    );
    generated(
      slabShell(data.walk, (x, z) => pavementHeight(street, x, z), -0.2, 0.15, [
        ...street.walkRamp.positions,
        ...street.vehicleRamp.positions,
      ]),
      concrete,
      groups.sidewalks,
    );
    generated(street.vehicleRamp, concrete, groups.sidewalks);
    buildMarkings();
    detail();
    calming();
    [
      "markings",
      "crossings",
      "drainage",
      "manholes",
      "lights",
      "landscape",
      "bollards",
    ].forEach((k) => batch(groups[k]));
    traffic();
    Object.entries(m.layers).forEach(([k, v]) => {
      if (groups[k]) groups[k].visible = v;
    });
    groups.ramps.visible =
      m.layers.ramps !== false && m.layers.sidewalks !== false;
    selection(selected);
    return data;
  }
  function selection(id) {
    selected = id;
    clear(groups.selection);
    const connection = model.connections?.find((c) => c.id === id);
    if (connection) {
      const result = bridgeResults.find((b) => b.id === id && b.valid),
        points = result
          ? result.frames.map((p) => new THREE.Vector3(p.x, p.y + 0.04, p.z))
          : connection.points.map((p) => new THREE.Vector3(p[0], 0.29, p[1]));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: "#c4e6ab" }),
      );
      groups.selection.add(line);
      return;
    }

    if (!id || !model) return;
    const n = model.nodes.find((n) => n.id === id);
    if (n) {
      const ring = mesh(
        new THREE.TorusGeometry(3.2, 0.13, 8, 64),
        new THREE.MeshBasicMaterial({ color: "#b9daa5", depthTest: false }),
        groups.selection,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(n.x, 0.5 + heightOf(n), n.z);
      ring.renderOrder = 10;
      for (const [axis, col] of [
        [new THREE.Vector3(0, 1, 0), "#a6c897"],
        [new THREE.Vector3(1, 0, 0), "#d9897f"],
        [new THREE.Vector3(0, 0, 1), "#7eade1"],
      ])
        groups.selection.add(
          new THREE.ArrowHelper(
            axis,
            new THREE.Vector3(n.x, 0.6 + heightOf(n), n.z),
            9,
            col,
            1.5,
            0.8,
          ),
        );
    } else {
      const r = data.sampled.find((r) => r.id === id);
      if (r) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          r.samples.map(
            (p, i) =>
              new THREE.Vector3(
                p[0],
                0.3 + roadElevation(r, model, r.samples.stations[i]),
                p[1],
              ),
          ),
        );
        groups.selection.add(
          new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({ color: "#c4e6ab", depthTest: false }),
          ),
        );
        for (const p of [
          r.samples[0],
          r.samples.at(-1),
          r.control || [
            (r.samples[0][0] + r.samples.at(-1)[0]) / 2,
            (r.samples[0][1] + r.samples.at(-1)[1]) / 2,
          ],
        ]) {
          const m = mesh(
            new THREE.SphereGeometry(0.9, 16, 12),
            new THREE.MeshBasicMaterial({ color: "#c4e6ab" }),
            groups.selection,
          );
          m.position.set(
            p[0],
            0.8 + roadElevation(r, model, roadStationAt(r, ...p)),
            p[1],
          );
        }
      }
    }
  }
  const ray = new THREE.Raycaster(),
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drawHeight = 0,
    verticalDrag = null;
  function groundPoint(event) {
    camera.updateMatrixWorld(true);
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const p = new THREE.Vector3();
    const level =
      mode === "draw"
        ? drawHeight
        : drag
          ? model.nodes.find((n) => n.id === drag)
            ? heightOf(model.nodes.find((n) => n.id === drag))
            : (() => {
                const r = data.sampled.find((r) => r.id === drag);
                return r
                  ? roadElevation(r, model, r.samples.lengthMeters / 2)
                  : 0;
              })()
          : 0;
    const pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
    return ray.ray.intersectPlane(pickPlane, p) ? [p.x, p.z] : null;
  }
  let down = null,
    drag = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, mode };
    const p = groundPoint(e);
    if (!p) return;
    if (mode === "draw") {
      onDraw(p);
      controls.enabled = false;
      return;
    }
    if (mode === "move") {
      const rect = renderer.domElement.getBoundingClientRect();
      const screenDistance = (x, y, z) => {
        const p = new THREE.Vector3(x, y, z).project(camera);
        return Math.hypot(
          rect.left + ((p.x + 1) * rect.width) / 2 - e.clientX,
          rect.top + ((1 - p.y) * rect.height) / 2 - e.clientY,
        );
      };
      const r = model.roads.find((r) => r.id === selected),
        a = r && model.nodes.find((n) => n.id === r.a),
        b = r && model.nodes.find((n) => n.id === r.b),
        control = r && (r.control || [(a.x + b.x) / 2, (a.z + b.z) / 2]);
      if (
        r &&
        screenDistance(
          control[0],
          0.8 +
            roadElevation(
              data.sampled.find((x) => x.id === r.id),
              model,
              roadStationAt(
                data.sampled.find((x) => x.id === r.id),
                ...control,
              ),
            ),
          control[1],
        ) < 18
      ) {
        drag = r.id;
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
      const n = model.nodes
        .map((n) => ({ n, d: screenDistance(n.x, heightOf(n) + 0.5, n.z) }))
        .filter((v) => v.d < 24)
        .sort((a, b) => a.d - b.d)[0]?.n;
      if (n) {
        drag = n.id;
        controls.enabled = false;
        onSelect(n.id);
        renderer.domElement.setPointerCapture(e.pointerId);
        if (e.shiftKey)
          verticalDrag = {
            x: n.x,
            z: n.z,
            y: heightOf(n),
            pixel: e.clientY,
            scale:
              (2 *
                camera.position.distanceTo(
                  new THREE.Vector3(n.x, heightOf(n), n.z),
                ) *
                Math.tan((camera.fov * Math.PI) / 360)) /
              rect.height,
          };
      }
    }
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (drag) {
      const p = groundPoint(e);
      if (verticalDrag)
        onMove(
          drag,
          [
            verticalDrag.x,
            verticalDrag.z,
            Math.round(
              (verticalDrag.y +
                (verticalDrag.pixel - e.clientY) * verticalDrag.scale) *
                4,
            ) / 4,
          ],
          false,
        );
      else if (p) onMove(drag, p, false);
    }
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (drag) {
      const p = groundPoint(e);
      if (verticalDrag)
        onMove(
          drag,
          [
            verticalDrag.x,
            verticalDrag.z,
            Math.round(
              (verticalDrag.y +
                (verticalDrag.pixel - e.clientY) * verticalDrag.scale) *
                4,
            ) / 4,
          ],
          true,
        );
      else if (p) onMove(drag, p, true);
      drag = null;
      verticalDrag = null;
    } else if (
      mode === "select" &&
      down?.mode === "select" &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
    ) {
      const p = groundPoint(e);
      if (p) {
        const bridgeHit =
          model.layers.bridges !== false
            ? ray.intersectObjects(groups.bridges.children, true)[0]
            : null;
        const bridgeId = bridgeHit?.object.parent?.userData.connectionId;
        const connection = closestConnection(
          p,
          (model.connections || []).filter(
            (c) => c.kind === "walkway" && model.layers.walkways !== false,
          ),
        );
        const n = model.nodes.find((n) => distance([n.x, n.z], p) < 6);
        const r = nearestRoad(p, { ...model, roads: data.sampled });
        onSelect(
          bridgeHit?.object.parent?.userData.roadId ||
            bridgeHit?.object.parent?.userData.nodeId ||
            bridgeId ||
            connection?.id ||
            n?.id ||
            (r && r.distance < r.road.width / 2 + 2 ? r.road.id : null),
        );
      }
    }
    controls.enabled = mode !== "draw";
    down = null;
  });
  renderer.domElement.addEventListener("pointercancel", () => {
    drag = null;
    verticalDrag = null;
    down = null;
    controls.enabled = mode !== "draw";
  });
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  const scaleElement = host.querySelector(".scale");
  const screenRight = new THREE.Vector3(),
    scaleStart = new THREE.Vector3(),
    scaleEnd = new THREE.Vector3();
  function updateScale() {
    camera.updateMatrixWorld();
    screenRight.setFromMatrixColumn(camera.matrixWorld, 0);
    screenRight.y = 0;
    screenRight.normalize();
    scaleStart.copy(controls.target).project(camera);
    scaleEnd.copy(controls.target).add(screenRight).project(camera);
    const pixels = (Math.abs(scaleEnd.x - scaleStart.x) * host.clientWidth) / 2;
    if (!scaleElement || pixels < 1e-6) return;
    const base = 10 ** Math.floor(Math.log10(65 / pixels));
    const length = [1, 2, 5, 10]
      .map((n) => n * base)
      .reduce((a, b) =>
        Math.abs(a * pixels - 65) < Math.abs(b * pixels - 65) ? a : b,
      );
    scaleElement.style.width = `${length * pixels}px`;
    scaleElement.querySelector("span").textContent =
      `${Number(length.toPrecision(3))} m`;
    scaleElement.title = "Scale at the camera target on the ground plane";
  }
  let last = 0,
    frames = 0,
    fps = 60,
    fpsTime = 0;
  renderer.setAnimationLoop((t) => {
    const dt = Math.min((t - last) / 1000, 0.05) || 0;
    last = t;
    frames++;
    if (t - fpsTime > 1000) {
      fps = frames;
      frames = 0;
      fpsTime = t;
    }
    if (simulation) {
      if (!paused) simulation.step(dt);
      for (const state of carStates) {
        const p = simulation.pose(state);
        state.g.position.set(p.x, 0.12 + p.height, p.z);
        state.g.rotation.set(p.pitch, Math.atan2(p.dx, p.dz), 0, "YXZ");
      }
    }
    fly.update(dt);
    if (!fly.active) controls.update();
    const near = Math.max(
      0.03,
      Math.min(2, Math.abs(camera.position.y) * 0.02),
    );
    if (Math.abs(camera.near - near) > 0.001) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    if (tactileDomes) tactileDomes.visible = Math.abs(camera.position.y) < 180;
    updateScale();
    renderer.render(scene, camera);
  });
  return {
    get backend() {
      return backend;
    },
    rebuild,
    selection,
    get connections() {
      return {
        warnings: [
          ...data.connectionWarnings,
          ...bridgeResults.flatMap((b) =>
            b.warnings.map((message) => ({ id: b.id, message })),
          ),
        ],
        bridges: bridgeResults.map((b) => ({
          id: b.id,
          valid: b.valid,
          length: b.length,
          grade: b.grade,
          targetGrade: b.targetGrade,
          clearanceTarget: b.clearanceTarget,
          approaches: b.approaches,
          clearance: b.clearance,
          protectedRange: b.protectedRange,
          profile: (b.frames || [])
            .filter(
              (p, i, a) =>
                i % Math.max(1, Math.ceil(a.length / 120)) === 0 ||
                i === a.length - 1,
            )
            .map((p) => [p.s, p.y]),
        })),
      };
    },
    get navigation() {
      return {
        active: fly.active,
        speed: fly.speed,
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        near: camera.near,
      };
    },
    get streetscape() {
      return {
        crossings: street.crossings.length,
        ramps: street.ramps.length,
        parallelRamps: street.ramps.filter((r) => r.kind === "parallel").length,
        vehicleCrossovers: street.driveways.length,
        vehicleRoads: street.driveways.map((r) => r.roadId),
        grates: street.grates.length,
        manholes: street.manholes.length,
        tactiles: street.tactiles.length,
        warnings: street.warnings,
      };
    },
    get trafficState() {
      return carStates.map((c) => ({
        id: c.id,
        road: c.leg.road?.id,
        connector: !!c.leg.connector,
        s: c.s,
        ...simulation.pose(c),
      }));
    },
    get data() {
      return data;
    },
    get fps() {
      return fps;
    },
    setMode(v) {
      fly.stop();
      mode = v;
      controls.enabled = v !== "draw";
      renderer.domElement.style.cursor =
        v === "draw" ? "crosshair" : v === "move" ? "move" : "default";
    },
    setLayer(k, v) {
      if (groups[k]) groups[k].visible = v;
    },
    setPaused(v) {
      paused = v;
    },
    setWire(v) {
      wire = v;
      asphalt.wireframe = v;
      paving.wireframe = v;
      concrete.wireframe = v;
    },
    setGrid(v) {
      grid.visible = v;
    },
    setLight(v) {
      sun.intensity = v;
    },
    streetView() {
      fly.stop();
      const node = model.nodes.find((n) => n.id === selected);
      const r =
        street.driveways.find((r) => r.roadId === selected) ||
        street.ramps.find((r) => r.roadId === selected) ||
        (!selected ? street.ramps[0] : null);
      if (node) {
        const source = data.sampled.find(
          (r) => r.a === node.id || r.b === node.id,
        );
        if (!source) return;
        const p = frameAt(
            source,
            source.a === node.id ? 0 : source.samples.lengthMeters,
          ),
          eye = localPoint(p, -5, p.width / 2 - 2),
          target = localPoint(p, 0, p.width / 2 + 1);
        camera.position.set(eye[0], 2.8 + heightOf(node), eye[1]);
        controls.target.set(target[0], 0.27 + heightOf(node), target[1]);
      } else if (r) {
        const eye = rampPoint(r, -r.half - 2, -2.5),
          target = rampPoint(r, 0, Math.min(0.8, r.depth));
        camera.position.set(eye[0], 1.65, eye[1]);
        controls.target.set(
          target[0],
          rampHeight(r, ...target) + 0.15,
          target[1],
        );
      } else {
        const r =
          data.sampled.find((r) => r.id === selected) || data.sampled[0];
        if (!r) return;
        const p = {
            ...station(r.samples, r.samples.lengthMeters / 2),
            width: r.width,
          },
          eye = localPoint(p, -5, p.width / 2 - 2.5),
          target = localPoint(p, 0, p.width / 2 + 0.8);
        const level = roadElevation(r, model, r.samples.lengthMeters / 2);
        camera.position.set(eye[0], 1.65 + level, eye[1]);
        controls.target.set(target[0], 0.4 + level, target[1]);
      }
      camera.near = 0.03;
      camera.updateProjectionMatrix();
      controls.update();
      camera.updateMatrixWorld(true);
    },
    setView(view) {
      fly.stop();
      if (view === "top") {
        camera.position.set(0, 410, 0.01);
        controls.target.set(0, 0, 0);
      } else {
        const xs = model.nodes.map((n) => n.x),
          zs = model.nodes.map((n) => n.z),
          span = Math.max(
            340,
            Math.max(...xs) - Math.min(...xs),
            Math.max(...zs) - Math.min(...zs),
          ),
          scale = span / 340;
        if (scale > 1.3) {
          controls.target.set(
            (Math.max(...xs) + Math.min(...xs)) / 2,
            0,
            (Math.max(...zs) + Math.min(...zs)) / 2,
          );
          camera.position
            .copy(controls.target)
            .add(new THREE.Vector3(222, 255, 268).multiplyScalar(scale * 1.15));
        } else {
          camera.position.set(222, 255, 268);
          controls.target.set(5, 0, -5);
        }
      }
      controls.update();
      camera.updateMatrixWorld(true);
    },
    focus(id) {
      const c = model.connections?.find((c) => c.id === id);
      if (c) {
        fly.stop();
        const xs = c.points.map((p) => p[0]),
          zs = c.points.map((p) => p[1]),
          cx = (Math.min(...xs) + Math.max(...xs)) / 2,
          cz = (Math.min(...zs) + Math.max(...zs)) / 2,
          size = Math.max(
            20,
            Math.max(...xs) - Math.min(...xs),
            Math.max(...zs) - Math.min(...zs),
          );
        controls.target.set(
          cx,
          c.kind === "bridge" ? c.height * 0.5 : 0.27,
          cz,
        );
        camera.position
          .copy(controls.target)
          .add(new THREE.Vector3(size * 0.75, size * 0.65, size * 0.8));
        controls.update();
        camera.updateMatrixWorld(true);
        return;
      }
      const road = data.sampled.find((r) => r.id === id);
      if (road) {
        fly.stop();
        const s = road.samples.lengthMeters / 2,
          p = atStation(road.samples, s),
          size = Math.max(25, road.samples.lengthMeters * 0.6);
        controls.target.set(p.x, 0.12 + roadElevation(road, model, s), p.z);
        camera.position
          .copy(controls.target)
          .add(new THREE.Vector3(size * 0.9, size * 0.55, size * 0.8));
        controls.update();
        camera.updateMatrixWorld(true);
        return;
      }
      const n = model.nodes.find((n) => n.id === id);
      if (n) {
        const d = camera.position.clone().sub(controls.target);
        controls.target.set(n.x, heightOf(n), n.z);
        camera.position.copy(controls.target).add(d.multiplyScalar(0.6));
      }
    },
    setDrawElevation(y) {
      drawHeight = y;
    },
    draft(points) {
      clear(groups.draft);
      if (points.length) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          points.map(
            (p) => new THREE.Vector3(p[0], 0.6 + (p[2] ?? drawHeight), p[1]),
          ),
        );
        groups.draft.add(
          new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({ color: "#c3e5a4" }),
          ),
        );
        points.forEach((p) => {
          const m = mesh(
            new THREE.SphereGeometry(1.2, 12, 8),
            new THREE.MeshBasicMaterial({ color: "#c3e5a4" }),
            groups.draft,
          );
          m.position.set(p[0], 0.6 + (p[2] ?? drawHeight), p[1]);
        });
      }
    },
    exportOBJ() {
      let out =
          "# Slate road surfaces and network bridge slab components — metres\n",
        base = 0;
      const parts = [
        { id: "ground", mesh: data.mesh },
        ...(data.structures || []).flatMap((p) => [
          { id: p.id + "_top", mesh: p.top },
          { id: p.id + "_shell", mesh: p.shell },
        ]),
      ];
      for (const part of parts) {
        const d = part.mesh;
        out += `o ${part.id}\n`;
        for (let i = 0; i < d.positions.length; i += 3)
          out += `v ${d.positions[i]} ${d.positions[i + 1]} ${d.positions[i + 2]}\n`;
        for (let i = 0; i < d.indices.length; i += 3)
          out += `f ${base + d.indices[i] + 1} ${base + d.indices[i + 1] + 1} ${base + d.indices[i + 2] + 1}\n`;
        base += d.positions.length / 3;
      }
      return out;
    },
  };
}
