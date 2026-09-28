import * as THREE from 'three';
import { loft, tube, scaleTexture, lerp, hash2 } from './util.js';
import { featherMaterials, makeFeather, featherRecord } from './feathers.js';

const D = Math.PI / 180;

// =====================================================================
// Bald eagle, built to real proportions (meters):
// body ~0.55 m torso, wingspan ~2.1 m, standing ~0.55 m tall.
// Forward = +Z, up = +Y. Right wing = +X.
// =====================================================================
export function buildEagle() {
  const F = featherMaterials();
  const bones = {};
  const feathers = { wing: [], tail: [], body: [] };
  const parts = {};
  const meshes = [];

  const matBody = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.95 });
  const matWhiteSkin = new THREE.MeshStandardMaterial({ color: 0xe7e2d5, roughness: 0.9 });
  const matBeak = new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.45, metalness: 0.05 });
  const matBeakDk = new THREE.MeshStandardMaterial({ color: 0xd89b1f, roughness: 0.5 });
  const matClaw = new THREE.MeshStandardMaterial({ color: 0x17130e, roughness: 0.35 });
  const matEye = new THREE.MeshStandardMaterial({ color: 0xe8c53a, roughness: 0.15 });
  const matPupil = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.1 });
  const matFoot = new THREE.MeshStandardMaterial({ color: 0xeeb838, roughness: 0.6, map: scaleTexture() });
  const matMembrane = new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 0.95, side: THREE.DoubleSide });

  function bone(name, parent, x, y, z) {
    const b = new THREE.Object3D();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    bones[name] = b;
    return b;
  }
  function addMesh(geo, mat, parent, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    if (opts.p) m.position.set(...opts.p);
    if (opts.r) m.rotation.set(...opts.r);
    if (opts.s) m.scale.set(...opts.s);
    if (opts.name) m.name = opts.name;
    parent.add(m);
    meshes.push(m);
    return m;
  }

  const root = new THREE.Object3D(); root.name = 'root';
  bones['root'] = root;

  // ---------------- torso ----------------
  const body = bone('body', root, 0, 0.40, 0);
  // torso loft: rear (tail base) -> front (chest)
  const torsoGeo = loft([
    { z: -0.285, rx: 0.050, ry: 0.052, y: 0.030 },
    { z: -0.22, rx: 0.088, ry: 0.096, y: 0.022 },
    { z: -0.13, rx: 0.118, ry: 0.132, y: 0.010 },
    { z: -0.02, rx: 0.135, ry: 0.150, y: 0.000 },
    { z: 0.09, rx: 0.132, ry: 0.148, y: 0.008 },
    { z: 0.18, rx: 0.110, ry: 0.126, y: 0.024 },
    { z: 0.245, rx: 0.070, ry: 0.082, y: 0.052 },
  ], 28);
  const torso = addMesh(torsoGeo, matBody, body, { name: 'torsoMesh' });
  parts.torso = torso;

  // torso surface sampler for contour feather placement
  const T_SEC = [
    [-0.285, 0.050, 0.052, 0.030],
    [-0.22, 0.088, 0.096, 0.022],
    [-0.13, 0.118, 0.132, 0.010],
    [-0.02, 0.135, 0.150, 0.000],
    [0.09, 0.132, 0.148, 0.008],
    [0.18, 0.110, 0.126, 0.024],
    [0.245, 0.070, 0.082, 0.052],
  ];
  function torsoAt(u, theta) { // u: 0 front -> 1 rear
    const z = lerp(0.245, -0.285, u);
    let i = 0;
    while (i < T_SEC.length - 2 && T_SEC[i + 1][0] > z) i++;
    // T_SEC ordered rear->front by z ascending; find bracket
    let a = T_SEC[0], b = T_SEC[T_SEC.length - 1];
    for (let k = 0; k < T_SEC.length - 1; k++) {
      if (z >= T_SEC[k][0] && z <= T_SEC[k + 1][0]) { a = T_SEC[k]; b = T_SEC[k + 1]; break; }
    }
    const t = (z - a[0]) / (b[0] - a[0] + 1e-9);
    const rx = lerp(a[1], b[1], t), ry = lerp(a[2], b[2], t), y0 = lerp(a[3], b[3], t);
    const p = new THREE.Vector3(Math.cos(theta) * rx, y0 + Math.sin(theta) * ry, z);
    const n = new THREE.Vector3(Math.cos(theta) / rx, Math.sin(theta) / ry, 0).normalize();
    return { p, n };
  }

  // ---------------- neck & head ----------------
  const chest = bone('chest', body, 0, 0.03, 0.16);
  const neckA = bone('neckA', chest, 0, 0.055, 0.075);
  const neckB = bone('neckB', neckA, 0, 0.085, 0.030);
  const head = bone('head', neckB, 0, 0.080, 0.030);

  // neck filler lofts (white)
  addMesh(loft([
    { z: -0.045, rx: 0.062, ry: 0.062 },
    { z: 0.02, rx: 0.056, ry: 0.058, y: 0.005 },
    { z: 0.06, rx: 0.050, ry: 0.052, y: 0.008 },
  ], 18), matWhiteSkin, neckA, { r: [-1.25, 0, 0], p: [0, 0.02, 0.01] });
  addMesh(loft([
    { z: -0.05, rx: 0.055, ry: 0.055 },
    { z: 0.02, rx: 0.049, ry: 0.050 },
    { z: 0.065, rx: 0.044, ry: 0.045 },
  ], 18), matWhiteSkin, neckB, { r: [-1.35, 0, 0], p: [0, 0.02, 0.01] });

  // skull: slightly flattened, longer than wide
  const skullGeo = loft([
    { z: -0.062, rx: 0.030, ry: 0.034, y: 0.000 },
    { z: -0.040, rx: 0.048, ry: 0.050, y: 0.004 },
    { z: -0.005, rx: 0.054, ry: 0.055, y: 0.006 },
    { z: 0.030, rx: 0.049, ry: 0.049, y: 0.004 },
    { z: 0.055, rx: 0.038, ry: 0.040, y: -0.002 },
    { z: 0.070, rx: 0.028, ry: 0.030, y: -0.008 },
  ], 22);
  addMesh(skullGeo, matWhiteSkin, head, { name: 'skull' });

  // supraorbital brow ridges — the fierce eagle look (subtle shelf over the eye)
  for (const s of [-1, 1]) {
    addMesh(new THREE.SphereGeometry(0.012, 12, 8),
      matWhiteSkin, head, {
        p: [s * 0.038, 0.027, 0.042],
        s: [1.1, 0.30, 1.5],
        r: [0.35, 0, s * -0.45],
      });
  }
  // eyes (deep set under brow)
  parts.eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Object3D();
    eye.position.set(s * 0.040, 0.013, 0.043);
    head.add(eye);
    bones['eye' + (s > 0 ? 'R' : 'L')] = eye;
    const ball = addMesh(new THREE.SphereGeometry(0.0135, 16, 12), matEye, eye);
    addMesh(new THREE.SphereGeometry(0.0080, 12, 10), matPupil, eye,
      { p: [s * 0.0092, 0.0005, 0.0040] });
    parts.eyes.push(eye);
    void ball;
  }

  // ------------- beak (large, hooked) -------------
  const beak = new THREE.Object3D();
  beak.position.set(0, -0.002, 0.062);
  head.add(beak);
  // cere (fleshy base)
  addMesh(loft([
    { z: -0.008, rx: 0.0245, ry: 0.0265, y: 0.010 },
    { z: 0.010, rx: 0.0235, ry: 0.0255, y: 0.010 },
    { z: 0.022, rx: 0.0215, ry: 0.0235, y: 0.008 },
  ], 16), matBeakDk, beak);
  // upper mandible with down-curving culmen and hook
  addMesh(loft([
    { z: 0.000, rx: 0.0225, ry: 0.0245, y: 0.008 },
    { z: 0.022, rx: 0.0205, ry: 0.0220, y: 0.007 },
    { z: 0.040, rx: 0.0180, ry: 0.0185, y: 0.003 },
    { z: 0.055, rx: 0.0140, ry: 0.0140, y: -0.006 },
    { z: 0.066, rx: 0.0090, ry: 0.0085, y: -0.020 },
    { z: 0.072, rx: 0.0045, ry: 0.0045, y: -0.034 },
    { z: 0.0735, rx: 0.0015, ry: 0.0018, y: -0.046 },
  ], 16), matBeak, beak, { name: 'upperBeak' });
  // nostrils
  for (const s of [-1, 1]) {
    addMesh(new THREE.SphereGeometry(0.0035, 8, 6), matClaw, beak,
      { p: [s * 0.017, 0.011, 0.017], s: [0.7, 0.55, 1.3], r: [0, 0, s * 0.5] });
  }
  // lower mandible on a jaw bone (opens)
  const jaw = bone('jaw', head, 0, -0.030, 0.030);
  addMesh(loft([
    { z: 0.005, rx: 0.0190, ry: 0.0130, y: 0.004 },
    { z: 0.030, rx: 0.0170, ry: 0.0110, y: 0.004 },
    { z: 0.052, rx: 0.0130, ry: 0.0085, y: 0.002 },
    { z: 0.070, rx: 0.0070, ry: 0.0050, y: -0.003 },
    { z: 0.078, rx: 0.0020, ry: 0.0018, y: -0.006 },
  ], 14), matBeak, jaw, { name: 'lowerBeak' });
  // gape line (dark seam at mouth corner)
  for (const s of [-1, 1]) {
    addMesh(new THREE.CapsuleGeometry(0.0011, 0.022, 3, 6), matClaw, head,
      { p: [s * 0.021, -0.019, 0.050], r: [Math.PI / 2 - 0.35, 0, s * 0.30] });
  }

  // ---------------- tail ----------------
  const tailBase = bone('tail', body, 0, 0.02, -0.27);
  // 12 rectrices — white, fanned by animator
  const NT = 12;
  for (let i = 0; i < NT; i++) {
    const k = i - (NT - 1) / 2; // -5.5 .. 5.5
    const len = 0.30 - Math.abs(k) * 0.008;
    const f = makeFeather(len, 0.062, (i % 2 ? F.whiteBright : F.white), { pointy: 0.7, camber: 0.10, droop: 0.06 });
    f.name = `rect_${i}`;
    f.position.set(k * 0.006, -Math.abs(k) * 0.0022 + 0.002, -0.01);
    tailBase.add(f);
    const spread = new THREE.Euler(0.10 + Math.abs(k) * 0.008, Math.PI, 0, 'YXZ');
    feathers.tail.push({
      ...featherRecord(f, spread, spread, 'T', i, 0),
      k,
    });
  }
  // upper tail coverts: dark outer row closing the rump, white inner row
  for (let i = 0; i < 10; i++) {
    const k = i - 4.5;
    const f = makeFeather(0.16, 0.055, F.bodyDark, { pointy: 0.55, droop: 0.14 });
    f.position.set(k * 0.014, 0.024, 0.035);
    f.rotation.set(0.35 - Math.abs(k) * 0.02, Math.PI + k * 0.16, 0, 'YXZ');
    tailBase.add(f);
  }
  for (let i = 0; i < 8; i++) {
    const k = i - 3.5;
    const f = makeFeather(0.13, 0.05, F.white, { pointy: 0.6, droop: 0.10 });
    f.position.set(k * 0.013, 0.012, 0.015);
    f.rotation.set(0.20, Math.PI + k * 0.12, 0, 'YXZ');
    tailBase.add(f);
  }
  for (let i = 0; i < 9; i++) { // under-tail
    const k = i - 4;
    const f = makeFeather(0.14, 0.055, F.white, { pointy: 0.6, droop: 0.08 });
    f.position.set(k * 0.013, -0.016, 0.015);
    f.rotation.set(-0.14, Math.PI + k * 0.13, 0, 'YXZ');
    tailBase.add(f);
  }
  // rump sides: dark feathers closing the gap between body and tail
  for (let i = 0; i < 8; i++) {
    const k = i - 3.5;
    const f = makeFeather(0.15, 0.06, F.bodyMid, { pointy: 0.5, droop: 0.2 });
    f.position.set(k * 0.02, 0.01 + Math.abs(k) * 0.004, 0.05);
    f.rotation.set(0.12 - Math.abs(k) * 0.06 * Math.sign(0.5), Math.PI + k * 0.22, k * 0.1, 'YXZ');
    tailBase.add(f);
  }

  // ---------------- wings ----------------
  // Bone chain per wing: shoulder -> elbow (forearm) -> wrist (hand)
  // Right wing grows along +X; left is mirrored via sign s.
  const wingLens = { hum: 0.27, fore: 0.33, hand: 0.30 };
  const P_LEN = [0.295, 0.33, 0.36, 0.385, 0.405, 0.415, 0.41, 0.395, 0.37, 0.335];
  const P_FAN = [7, 14, 21, 29, 37, 45, 53, 60, 66, 71]; // degrees outward
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'R' : 'L';
    const shoulder = bone('shoulder' + sd, chest, s * 0.105, 0.055, -0.03);
    const elbow = bone('elbow' + sd, shoulder, s * wingLens.hum, 0.004, -0.045);
    const wrist = bone('wrist' + sd, elbow, s * wingLens.fore, 0.002, -0.05);

    // flesh over bones
    addMesh(tube(
      [[0, 0, 0.012], [s * 0.14, 0.0, -0.012], [s * wingLens.hum, -0.002, -0.040]],
      [0.034, 0.028, 0.020], 10), matBody, shoulder);
    // marginal coverts: tiny feathers shingling the propatagium leading edge
    for (let i = 0; i < 9; i++) {
      const t2 = i / 8;
      const f = makeFeather(0.055, 0.034, F.covertMid, { pointy: 0.6 });
      f.position.set(s * (0.03 + t2 * 0.22), 0.008 - t2 * 0.004, 0.018 - t2 * 0.038);
      f.rotation.set(0.18, Math.PI + s * 4 * D, s * 0.05, 'YXZ');
      shoulder.add(f);
      feathers.wing.push(featherRecord(f,
        new THREE.Euler(0.18, Math.PI + s * 4 * D, s * 0.05, 'YXZ'),
        new THREE.Euler(0.0, Math.PI + s * 4 * D, s * 0.5, 'YXZ'), 'MG', i, s));
    }
    addMesh(tube(
      [[0, 0, 0], [s * 0.17, 0.002, -0.022], [s * wingLens.fore, 0.002, -0.048]],
      [0.023, 0.019, 0.013], 8), matBody, elbow);
    addMesh(tube(
      [[0, 0, 0], [s * 0.16, 0, -0.012], [s * wingLens.hand, -0.002, -0.030]],
      [0.012, 0.009, 0.004], 8), matBody, wrist);
    // propatagium (leading-edge skin): two pieces so it follows the fold
    const memMat = matMembrane;
    {
      const shape = new THREE.BufferGeometry();
      const pts = new Float32Array([
        0, 0.008, 0.02,
        s * wingLens.hum, 0.002, -0.055,
        s * 0.13, -0.002, -0.045,
        0, -0.008, 0.02,
        s * wingLens.hum, -0.004, -0.055,
        s * 0.13, -0.012, -0.045,
      ]);
      shape.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      shape.setIndex([0, 1, 2, 3, 5, 4]);
      shape.computeVertexNormals();
      addMesh(shape, memMat, shoulder);
    }
    {
      const shape = new THREE.BufferGeometry();
      const pts = new Float32Array([
        0, 0.005, 0.003,
        s * wingLens.fore * 0.85, 0.002, -0.030,
        s * wingLens.fore * 0.45, -0.002, -0.028,
        0, -0.005, 0.003,
        s * wingLens.fore * 0.85, -0.004, -0.030,
        s * wingLens.fore * 0.45, -0.008, -0.028,
      ]);
      shape.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      shape.setIndex([0, 1, 2, 3, 5, 4]);
      shape.computeVertexNormals();
      addMesh(shape, memMat, elbow);
    }

    // ---- primaries (on hand) ----
    for (let i = 0; i < 10; i++) {
      const a = 0.015 + (i / 9) * (wingLens.hand - 0.02);
      const f = makeFeather(P_LEN[i], 0.058 - i * 0.0016, F.primary,
        { pointy: 1.5, tipStart: 0.5, camber: 0.10, droop: 0.045 });
      f.name = `P${i + 1}${sd}`;
      f.position.set(s * a, -0.004 + i * 0.0012, -0.012);
      wrist.add(f);
      const spread = new THREE.Euler(
        0.035 + i * 0.010,                  // slight pitch-up toward tip (fingering)
        Math.PI - s * P_FAN[i] * D,
        s * (0.12 - i * 0.005),
        'YXZ');
      const fold = new THREE.Euler(
        -0.34 + i * 0.012,
        Math.PI - s * (1 + i * 1.2) * D,
        s * 0.42,
        'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'P', i, s));
    }
    // primary coverts
    for (let i = 0; i < 9; i++) {
      const a = 0.02 + (i / 8) * (wingLens.hand - 0.04);
      const f = makeFeather(0.135, 0.042, F.covertDark, { pointy: 1.0 });
      f.position.set(s * a, 0.004 + i * 0.001, -0.010);
      wrist.add(f);
      const spread = new THREE.Euler(0.10, Math.PI - s * (P_FAN[i] + 3) * D, s * 0.1, 'YXZ');
      const fold = new THREE.Euler(-0.22, Math.PI - s * (2 + i * 0.8) * D, s * 0.42, 'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'PC', i, s));
    }
    // alula (thumb feathers at wrist)
    for (let i = 0; i < 3; i++) {
      const f = makeFeather(0.085 + i * 0.012, 0.030, F.covertDark, { pointy: 1.3 });
      f.position.set(s * 0.012, 0.006, 0.012 - i * 0.008);
      wrist.add(f);
      const spread = new THREE.Euler(0.05, Math.PI - s * (30 + i * 6) * D, 0, 'YXZ');
      const fold = new THREE.Euler(-0.05, Math.PI - s * 6 * D, s * 0.45, 'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'AL', i, s));
    }
    // ---- secondaries (on forearm), trailing edge ----
    const NS = 13;
    for (let i = 0; i < NS; i++) {
      const t = i / (NS - 1); // 0 at wrist -> 1 at elbow
      const a = wingLens.fore - 0.015 - t * (wingLens.fore - 0.03);
      const len = 0.27 + Math.sin(t * Math.PI) * 0.03;
      const f = makeFeather(len, 0.062, F.secondary, { pointy: 0.6, camber: 0.14, droop: 0.06 });
      f.name = `S${i + 1}${sd}`;
      f.position.set(s * a, -0.002 + t * 0.004, -0.020);
      elbow.add(f);
      const spread = new THREE.Euler(0.05, Math.PI + s * (2 + t * 7) * D, s * (0.10 - t * 0.02), 'YXZ');
      const fold = new THREE.Euler(-0.18, Math.PI + s * (3 + t * 8) * D, s * 0.45, 'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'S', i, s));
    }
    // greater coverts over secondaries
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const a = wingLens.fore - 0.02 - t * (wingLens.fore - 0.04);
      const f = makeFeather(0.155, 0.048, F.covertDark, { pointy: 0.8 });
      f.position.set(s * a, 0.006 + t * 0.003, -0.012);
      elbow.add(f);
      const spread = new THREE.Euler(0.12, Math.PI + s * (3 + t * 6) * D, s * 0.08, 'YXZ');
      const fold = new THREE.Euler(-0.05, Math.PI + s * (3 + t * 6) * D, s * 0.5, 'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'GC', i, s));
    }
    // median + lesser coverts (two rows, shorter, lie flatter)
    for (let row = 0; row < 2; row++) {
      const n = row === 0 ? 11 : 10;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = wingLens.fore - 0.02 - t * (wingLens.fore - 0.05);
        const f = makeFeather(row === 0 ? 0.10 : 0.068, 0.040, F.covertMid, { pointy: 0.7 });
        f.position.set(s * a, 0.011 + row * 0.005, 0.003 + row * 0.017);
        elbow.add(f);
        const spread = new THREE.Euler(0.16 + row * 0.06, Math.PI + s * (2 + t * 5) * D, s * 0.06, 'YXZ');
        const fold = new THREE.Euler(0.0, Math.PI + s * 4 * D, s * 0.55, 'YXZ');
        feathers.wing.push(featherRecord(f, spread, fold, 'MC', i + row * 20, s));
      }
    }
    // tertials + humeral tract (on shoulder bone)
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const a = wingLens.hum - 0.02 - t * (wingLens.hum - 0.05);
      const f = makeFeather(0.24 - t * 0.05, 0.06, F.secondary, { pointy: 0.55, camber: 0.15, droop: 0.08 });
      f.position.set(s * a, 0.004, -0.025);
      shoulder.add(f);
      const spread = new THREE.Euler(0.06, Math.PI + s * (8 + t * 6) * D, s * 0.06, 'YXZ');
      const fold = new THREE.Euler(-0.08, Math.PI + s * (6 + t * 5) * D, s * 0.45, 'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'TT', i, s));
    }
    // humeral coverts / scapulars riding the shoulder
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const a = wingLens.hum - 0.03 - t * (wingLens.hum - 0.05);
      const f = makeFeather(0.13 - t * 0.02, 0.05, F.covertMid, { pointy: 0.6 });
      f.position.set(s * a, 0.016, -0.005);
      shoulder.add(f);
      const spread = new THREE.Euler(0.18, Math.PI + s * (6 + t * 5) * D, s * 0.05, 'YXZ');
      const fold = new THREE.Euler(0.0, Math.PI + s * 5 * D, s * 0.5, 'YXZ');
      feathers.wing.push(featherRecord(f, spread, fold, 'HC', i, s));
    }
  }

  // ---------------- body contour feathers ----------------
  // shingled rows, front->rear along torso
  const rows = [
    { u: 0.10, len: 0.075, mat: 'bodyMid' },
    { u: 0.20, len: 0.085, mat: 'bodyMid' },
    { u: 0.30, len: 0.095, mat: 'bodyDark' },
    { u: 0.41, len: 0.10, mat: 'bodyDark' },
    { u: 0.52, len: 0.105, mat: 'bodyMid' },
    { u: 0.63, len: 0.11, mat: 'bodyDark' },
    { u: 0.74, len: 0.115, mat: 'bodyDark' },
    { u: 0.85, len: 0.125, mat: 'bodyMid' },
    { u: 0.94, len: 0.14, mat: 'bodyDark' },
  ];
  const zAxis = new THREE.Vector3(0, 0, -1);
  for (const row of rows) {
    const { p: pr } = torsoAt(row.u, 0);
    const circ = 2 * Math.PI * Math.max(0.05, pr.x);
    const count = Math.max(6, Math.round(circ / 0.048));
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + (row.u * 7) % 0.5;
      const { p, n } = torsoAt(row.u, theta);
      const jitter = hash2(i, row.u * 100);
      const matPick = jitter < 0.33 ? F.bodyDark : jitter < 0.72 ? F[row.mat] : F.bodyLight;
      // breast (front, lower half) lighter
      const isBreast = row.u < 0.42 && Math.sin(theta) < -0.2;
      const f = makeFeather(row.len * (0.9 + jitter * 0.25), 0.052,
        isBreast ? F.bodyMid : matPick, { pointy: 0.55, camber: 0.2, droop: 0.16 });
      f.position.copy(p);
      const dir = zAxis.clone().add(n.clone().multiplyScalar(0.30)).normalize();
      const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), n);
      f.quaternion.setFromRotationMatrix(m4);
      body.add(f);
      feathers.body.push({ mesh: f, baseQ: f.quaternion.clone(), phase: jitter * 6.28, n });
    }
  }

  // white neck hackles (lanceolate) — rings on neckA, neckB, head base
  const hackleTargets = [
    { b: neckA, r: 0.063, n: 16, len: 0.105, y: -0.012, droopK: 0.55 },
    { b: neckA, r: 0.059, n: 15, len: 0.095, y: 0.030, droopK: 0.5 },
    { b: neckA, r: 0.056, n: 14, len: 0.088, y: 0.062, droopK: 0.48 },
    { b: neckB, r: 0.054, n: 14, len: 0.082, y: 0.005, droopK: 0.45 },
    { b: neckB, r: 0.051, n: 13, len: 0.072, y: 0.042, droopK: 0.4 },
    { b: head, r: 0.049, n: 13, len: 0.062, y: -0.042, droopK: 0.35 },
    { b: head, r: 0.050, n: 12, len: 0.055, y: -0.012, droopK: 0.3 },
  ];
  for (const H of hackleTargets) {
    for (let i = 0; i < H.n; i++) {
      const th = (i / H.n) * Math.PI * 2 + 0.3;
      const f = makeFeather(H.len, 0.036, F.white, { pointy: 1.1, camber: 0.06, droop: 0.10 });
      f.castShadow = false;
      // ring around the (roughly vertical) neck axis
      const cx = Math.cos(th) * H.r, cz = Math.sin(th) * H.r * 0.85;
      f.position.set(cx, H.y, cz);
      // drape downward, hugging the neck, tips slightly out
      const dir = new THREE.Vector3(cx * H.droopK * 6, -1, cz * H.droopK * 6 - 0.12).normalize();
      const n = new THREE.Vector3(cx, 0.15, cz).normalize();
      const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), n);
      f.quaternion.setFromRotationMatrix(m4);
      H.b.add(f);
    }
  }
  // white bib on upper chest
  for (let i = 0; i < 10; i++) {
    const th = (i - 4.5) * 0.33;
    const f = makeFeather(0.085, 0.028, F.white, { pointy: 1.3, droop: 0.12 });
    f.castShadow = false;
    f.position.set(Math.sin(th) * 0.062, 0.035 - Math.abs(th) * 0.02, 0.045);
    const dir = new THREE.Vector3(Math.sin(th) * 0.35, -1, 0.30).normalize();
    const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(Math.sin(th), 0.3, 0.9).normalize());
    f.quaternion.setFromRotationMatrix(m4);
    chest.add(f);
  }
  // nape: shingled white feathers covering the back of the skull
  for (let r = 0; r < 3; r++) {
    const n = 7 + r;
    for (let i = 0; i < n; i++) {
      const th = ((i + 0.5) / n - 0.5) * Math.PI * 1.15;
      const rr = 0.040 + r * 0.006;
      const f = makeFeather(0.055 + r * 0.012, 0.030, F.white, { pointy: 0.9, droop: 0.14 });
      f.castShadow = false;
      f.position.set(Math.sin(th) * rr, 0.030 - r * 0.026 + Math.cos(th) * 0.012, -0.040 + r * 0.004);
      const n2 = new THREE.Vector3(Math.sin(th) * 0.8, 0.5 - r * 0.25, -0.6).normalize();
      const dir = new THREE.Vector3(Math.sin(th) * 0.30, -0.35 - r * 0.15, -1).normalize();
      const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), n2);
      f.quaternion.setFromRotationMatrix(m4);
      head.add(f);
    }
  }
  // crown feathers (tiny, lying flat, flowing back over skull)
  for (let i = 0; i < 10; i++) {
    const th = (i / 10) * Math.PI - Math.PI / 2;
    const f = makeFeather(0.035, 0.016, F.white, { pointy: 1.1, droop: 0.06 });
    f.castShadow = false;
    f.position.set(Math.sin(th) * 0.038, 0.028 + Math.cos(th) * 0.022, 0.005);
    const n = new THREE.Vector3(Math.sin(th) * 0.7, Math.cos(th) * 0.8 + 0.3, 0).normalize();
    const dir = new THREE.Vector3(Math.sin(th) * 0.2, 0.12, -1).add(n.clone().multiplyScalar(0.10)).normalize();
    const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), n);
    f.quaternion.setFromRotationMatrix(m4);
    head.add(f);
  }

  // ---------------- legs ----------------
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'R' : 'L';
    const thigh = bone('thigh' + sd, body, s * 0.065, -0.09, -0.02);
    const shin = bone('shin' + sd, thigh, 0, -0.085, 0.015);
    const tarsus = bone('tarsus' + sd, shin, 0, -0.088, -0.008);
    const foot = bone('foot' + sd, tarsus, 0, -0.092, 0.006);

    addMesh(tube([[0, 0.01, 0], [0, -0.05, 0.008], [0, -0.088, 0.012]],
      [0.038, 0.030, 0.022], 10), matBody, thigh);
    addMesh(tube([[0, 0.01, 0], [0, -0.05, -0.004], [0, -0.09, -0.006]],
      [0.024, 0.019, 0.014], 9), matBody, shin);
    // bare yellow tarsus
    addMesh(tube([[0, 0.012, 0], [0, -0.045, 0.003], [0, -0.094, 0.006]],
      [0.0125, 0.0105, 0.0115], 9), matFoot, tarsus);

    // feathered 'pants'
    for (let i = 0; i < 7; i++) {
      const th = (i / 7) * Math.PI * 2;
      const f = makeFeather(0.10, 0.038, F.bodyMid, { pointy: 0.8, droop: 0.3 });
      f.position.set(Math.cos(th) * 0.024, -0.01, Math.sin(th) * 0.02);
      const dir = new THREE.Vector3(Math.cos(th) * 0.5, -1, Math.sin(th) * 0.4 - 0.25).normalize();
      const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(0, 0, -1));
      f.quaternion.setFromRotationMatrix(m4);
      shin.add(f);
    }

    // toes: 3 forward + hallux
    const toeSpecs = [
      { yaw: -28 * D, len: 1.0 }, { yaw: 0, len: 1.15 }, { yaw: 28 * D, len: 0.95 },
      { yaw: Math.PI, len: 0.72 },
    ];
    toeSpecs.forEach((ts, ti) => {
      const toe = new THREE.Object3D();
      toe.rotation.y = ts.yaw;
      foot.add(toe);
      bones[`toe${ti}${sd}`] = toe;
      const L = 0.075 * ts.len;
      addMesh(tube(
        [[0, 0, 0], [0, 0.005, L * 0.35], [0, 0.002, L * 0.6], [0, 0.005, L * 0.85], [0, -0.004, L]],
        [0.0125, 0.0110, 0.0100, 0.0092, 0.007], 8), matFoot, toe);
      // curved black talon
      const clawLen = ti === 3 ? 1.25 : 1.0;
      addMesh(tube(
        [[0, 0.002, 0], [0, -0.001, 0.013 * clawLen], [0, -0.010, 0.023 * clawLen], [0, -0.023, 0.0285 * clawLen]],
        [0.0068, 0.0055, 0.0034, 0.0006], 8), matClaw, toe, { p: [0, 0.002, L - 0.002] });
    });
  }

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  const materials = {
    primary: F.primary, secondary: F.secondary,
    covertDark: F.covertDark, covertMid: F.covertMid,
    bodyDark: F.bodyDark, bodyMid: F.bodyMid, bodyLight: F.bodyLight,
    white: F.white, whiteBright: F.whiteBright,
    torso: matBody, skin: matWhiteSkin, beak: matBeak, cere: matBeakDk,
    foot: matFoot, eye: matEye, membrane: matMembrane,
  };
  return { root, bones, feathers, parts, materials };
}
