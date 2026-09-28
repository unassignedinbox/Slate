import * as THREE from 'three';

/*
  Procedural Bald Eagle (Haliaeetus leucocephalus)
  --------------------------------------------------
  Anatomy modelled from reference:
   - 10 primaries (p1..p10), ~14 secondaries, 3 tertials per wing
   - 12 tail rectrices (fan)
   - white head + tail, dark brown/grey body & wings, yellow hooked beak & feet
   - unfeathered scaly lower legs, heavy talons, pronounced brow ridge
  Everything is real 3D geometry (ellipsoids, capsules, extruded feather blades
  with shafts & camber). Joints are nested groups so motion propagates naturally.
  Facing convention: +Z forward, +Y up, +X = eagle's right.
*/

const COL = {
  bodyDark:   0x2c2015,
  bodyMid:    0x3d2c1c,
  breast:     0x4a3623,
  white:      0xf1ece1,
  whiteShade: 0xd9d2c4,
  beak:       0xf2b81c,
  beakTip:    0xd89a08,
  cere:       0xf4c22a,
  leg:        0xe8a81a,
  talon:      0x1a1712,
  eye:        0x2a1a08,
  iris:       0xf0c23a,
  featherDk:  0x2a241d,
  featherMd:  0x3a3125,
  featherTip: 0x1f1a14,
  mouth:      0x6e3630,
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.75,
    metalness: opts.metal ?? 0.02,
    side: opts.side ?? THREE.DoubleSide,
    flatShading: !!opts.flat,
  });
}

// ------- feather builder -------------------------------------------------
// Returns a Group whose pivot is at the quill base; blade runs along +X,
// width along Z, thin in Y. Includes a shaft and downward camber.
function makeFeather(len, wid, mat, opts = {}) {
  const g = new THREE.Group();
  const asym = opts.asym ?? 0.5;      // vane asymmetry (0..1)
  const curl = opts.curl ?? len * 0.14; // tip droop
  const notch = opts.notch ?? 0;      // emarginated finger tip (primaries)

  const s = new THREE.Shape();
  const wI = wid * asym;        // inner vane (wider)
  const wO = wid * (1 - asym);  // outer vane
  s.moveTo(0, -wO * 0.15);
  s.quadraticCurveTo(len * 0.45, -wO, len * 0.8, -wO * 0.72);
  if (notch > 0) {
    // finger-like emarginated tip
    s.lineTo(len * 0.86, -wO * 0.22);
    s.lineTo(len, -wO * 0.08);
    s.lineTo(len, wI * 0.08);
    s.lineTo(len * 0.86, wI * 0.2);
  } else {
    s.quadraticCurveTo(len * 0.98, -wO * 0.35, len, 0);
    s.quadraticCurveTo(len * 0.98, wI * 0.35, len * 0.86, wI * 0.2);
  }
  s.quadraticCurveTo(len * 0.5, wI, len * 0.14, wI * 0.55);
  s.quadraticCurveTo(len * 0.03, wI * 0.2, 0, wO * 0.15);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: opts.thick ?? 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.004,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 6,
  });
  geo.translate(0, 0, -(opts.thick ?? 0.006) / 2);
  geo.rotateX(-Math.PI / 2); // lay flat: length +X, width Z, thin Y

  // camber: droop the tip + slight downward curve along length
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const t = Math.max(0, x / len);
    pos.setY(i, pos.getY(i) - curl * t * t);
  }
  geo.computeVertexNormals();

  const blade = new THREE.Mesh(geo, mat);
  blade.castShadow = true;
  g.add(blade);

  // shaft (rachis)
  const shaftMat = std(0x171310, { rough: 0.6 });
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(wid * 0.03, wid * 0.012, len * 0.98, 5),
    shaftMat
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = len * 0.49;
  shaft.position.y = 0.004;
  // apply same droop to the shaft by bending is overkill; leave straight-ish
  g.add(shaft);

  g.userData.len = len;
  return g;
}

function ellipsoid(rx, ry, rz, mat, seg = 24) {
  const geo = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
  geo.scale(rx, ry, rz);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function limb(rTop, rBot, len, mat) {
  const geo = new THREE.CapsuleGeometry(rBot, len, 6, 12);
  // taper: scale top ring? Capsule uniform; approximate taper via lathe alt.
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// ------- wing --------------------------------------------------------------
function buildWing(name) {
  const featherMats = [
    std(COL.featherDk), std(COL.featherMd), std(COL.featherTip),
  ];
  const fMat = (i) => featherMats[i % 3];

  const shoulder = new THREE.Group(); shoulder.name = name + '_shoulder';

  // humerus (upper arm) — points +X
  const humLen = 0.30;
  const humerus = limb(0.05, 0.055, humLen * 0.7, std(COL.bodyDark));
  humerus.rotation.z = Math.PI / 2;
  humerus.position.x = humLen * 0.5;
  shoulder.add(humerus);

  const elbow = new THREE.Group(); elbow.name = name + '_elbow';
  elbow.position.x = humLen;
  shoulder.add(elbow);

  const foreLen = 0.30;
  const forearm = limb(0.04, 0.045, foreLen * 0.72, std(COL.bodyDark));
  forearm.rotation.z = Math.PI / 2;
  forearm.position.x = foreLen * 0.5;
  elbow.add(forearm);

  const wrist = new THREE.Group(); wrist.name = name + '_wrist';
  wrist.position.x = foreLen;
  elbow.add(wrist);

  const handLen = 0.14;
  const hand = limb(0.03, 0.032, handLen * 0.7, std(COL.bodyDark));
  hand.rotation.z = Math.PI / 2;
  hand.position.x = handLen * 0.5;
  wrist.add(hand);

  const primaries = [], secondaries = [], tertials = [], coverts = [];

  // helper to register a flight feather with base rotation
  function place(group, feather, x, y, z, rotY, rotZ, rotX = 0) {
    feather.position.set(x, y, z);
    feather.rotation.set(rotX, rotY, rotZ);
    feather.userData.base = { x: rotX, y: rotY, z: rotZ };
    group.add(feather);
    return feather;
  }

  // --- primaries (10): fan off the hand, sweeping from outward to back ---
  const NP = 10;
  for (let i = 0; i < NP; i++) {
    const u = i / (NP - 1);                 // 0 = outermost tip, 1 = inner
    const len = 0.46 - u * 0.10;            // p10 longest-ish region
    const wid = 0.052 + u * 0.02;
    const f = makeFeather(len, wid, fMat(i), {
      asym: 0.62, notch: u < 0.55 ? 0.5 : 0, curl: len * 0.12, thick: 0.006,
    });
    // outermost points outward(+X)&back; inner points back(-Z)
    const rotY = THREE.MathUtils.lerp(Math.PI * 0.22, Math.PI * 0.62, u);
    const rotZ = -0.05 - u * 0.06;          // slight droop
    const x = handLen * (0.15 + u * 0.85);
    place(wrist, f, x, 0.006 - u * 0.004, -0.01, rotY, rotZ);
    primaries.push(f);
  }

  // --- secondaries (14): trailing edge along forearm, pointing back ---
  const NS = 14;
  for (let i = 0; i < NS; i++) {
    const u = i / (NS - 1);                 // 0 near wrist, 1 near elbow
    const len = 0.34 - u * 0.03;
    const wid = 0.06 + u * 0.01;
    const f = makeFeather(len, wid, fMat(i + 1), {
      asym: 0.54, curl: len * 0.14, thick: 0.006,
    });
    const rotY = THREE.MathUtils.lerp(Math.PI * 0.60, Math.PI * 0.78, u);
    const rotZ = -0.06;
    const x = foreLen * (0.05 + (1 - u) * 0.92);
    place(elbow, f, x, 0.004, -0.008, rotY, rotZ);
    secondaries.push(f);
  }

  // --- tertials (3): innermost, drape over the back near the body ---
  for (let i = 0; i < 3; i++) {
    const len = 0.30 + i * 0.02;
    const f = makeFeather(len, 0.07, fMat(i), { asym: 0.5, curl: len * 0.18 });
    const rotY = Math.PI * (0.82 + i * 0.05);
    place(shoulder, f, 0.02 + i * 0.03, 0.02, -0.02, rotY, -0.05);
    tertials.push(f);
  }

  // --- greater coverts: overlap the base of the secondaries (upper side) ---
  for (let i = 0; i < 10; i++) {
    const u = i / 9;
    const len = 0.14 - u * 0.02;
    const f = makeFeather(len, 0.045, std(COL.featherMd), { asym: 0.5, curl: len * 0.1 });
    const rotY = THREE.MathUtils.lerp(Math.PI * 0.55, Math.PI * 0.78, u);
    const x = foreLen * (0.08 + (1 - u) * 0.85);
    place(elbow, f, x, 0.03, 0.03, rotY, -0.12);
    coverts.push(f);
  }
  // marginal / lesser coverts patch on the leading upper arm (smooth shoulder)
  for (let i = 0; i < 8; i++) {
    const u = i / 7;
    const len = 0.10;
    const f = makeFeather(len, 0.05, std(COL.bodyMid), { asym: 0.5, curl: 0.02 });
    place(shoulder, f, humLen * (0.15 + u * 0.8), 0.05, 0.06, Math.PI * 0.5, -0.25);
    coverts.push(f);
  }

  return { shoulder, elbow, wrist, primaries, secondaries, tertials, coverts };
}

// ------- head ---------------------------------------------------------------
function buildHead() {
  const head = new THREE.Group();
  const whiteMat = std(COL.white, { rough: 0.85 });

  const skull = ellipsoid(0.11, 0.10, 0.115, whiteMat, 28);
  skull.position.set(0, 0, 0.02);
  head.add(skull);

  // white nape blending toward neck
  const nape = ellipsoid(0.095, 0.095, 0.10, whiteMat, 20);
  nape.position.set(0, -0.04, -0.05);
  head.add(nape);

  // brow ridge — the fierce eagle scowl (yellow-ish skin over eye)
  const browMat = std(0xe7c98f, { rough: 0.7 });
  for (const s of [1, -1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.02, 0.07), browMat);
    brow.position.set(s * 0.075, 0.035, 0.06);
    brow.rotation.z = s * 0.35;
    brow.rotation.y = -s * 0.2;
    head.add(brow);
  }

  // eyes
  for (const s of [1, -1]) {
    const eyeG = new THREE.Group();
    eyeG.position.set(s * 0.082, 0.01, 0.075);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 14), std(COL.iris, { rough: 0.35 }));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 12), std(0x0a0805, { rough: 0.2 }));
    pupil.position.set(s * 0.006, 0, 0.02);
    iris.add(pupil);
    eyeG.add(iris);
    eyeG.rotation.y = s * 0.5;
    head.add(eyeG);
  }

  // cere (fleshy base of beak)
  const cere = ellipsoid(0.045, 0.04, 0.05, std(COL.cere, { rough: 0.55 }));
  cere.position.set(0, 0.0, 0.12);
  head.add(cere);

  // ---- beak (hooked) ----
  const beak = new THREE.Group();
  beak.position.set(0, 0.0, 0.14);
  head.add(beak);

  const beakMat = std(COL.beak, { rough: 0.35, metal: 0.05 });
  const beakTipMat = std(COL.beakTip, { rough: 0.3 });

  // upper mandible: tapered wedge then a downward hook
  const upper = new THREE.Group();
  const uBase = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.14, 16), beakMat);
  uBase.rotation.x = Math.PI / 2;   // point +Z
  uBase.scale.set(1, 0.72, 1);
  uBase.position.set(0, 0.005, 0.06);
  upper.add(uBase);
  // hook
  const hook = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.075, 14), beakTipMat);
  hook.rotation.x = Math.PI * 0.92;  // curl downward
  hook.position.set(0, -0.028, 0.135);
  hook.scale.set(1, 1.2, 0.8);
  upper.add(hook);
  // nostril nares
  for (const s of [1, -1]) {
    const nare = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), std(0x241a10));
    nare.position.set(s * 0.022, 0.01, 0.03);
    upper.add(nare);
  }
  beak.add(upper);

  // mouth interior (visible when open)
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), std(COL.mouth, { rough: 0.6 }));
  mouth.position.set(0, -0.01, 0.06);
  beak.add(mouth);

  // lower mandible (jaw) — hinged for screech
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.02, 0.01);
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 14), beakMat);
  lower.rotation.x = Math.PI / 2;
  lower.scale.set(0.9, 0.5, 1);
  lower.position.set(0, -0.01, 0.055);
  jaw.add(lower);
  beak.add(jaw);

  // tongue
  const tongue = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.05, 4, 8), std(0x7a4038, { rough: 0.7 }));
  tongue.rotation.x = Math.PI / 2;
  tongue.position.set(0, -0.005, 0.06);
  jaw.add(tongue);

  return { head, jaw, beak };
}

// ------- leg ---------------------------------------------------------------
function buildLeg(name) {
  const hip = new THREE.Group(); hip.name = name + '_hip';

  const featherPant = ellipsoid(0.05, 0.08, 0.05, std(COL.bodyDark)); // feathered thigh
  featherPant.position.set(0, -0.05, 0);
  hip.add(featherPant);

  const thigh = limb(0.03, 0.03, 0.06, std(COL.bodyDark));
  thigh.position.set(0, -0.09, 0);
  hip.add(thigh);

  const knee = new THREE.Group(); knee.name = name + '_knee';
  knee.position.set(0, -0.13, 0.0);
  hip.add(knee);

  // tarsus (scaly, yellow, unfeathered)
  const shinMat = std(COL.leg, { rough: 0.5 });
  const shin = limb(0.02, 0.022, 0.09, shinMat);
  shin.position.set(0, -0.06, 0);
  knee.add(shin);

  const ankle = new THREE.Group(); ankle.name = name + '_ankle';
  ankle.position.set(0, -0.12, 0);
  knee.add(ankle);

  // foot + talons
  const foot = new THREE.Group();
  ankle.add(foot);
  const talonMat = std(COL.talon, { rough: 0.3, metal: 0.1 });
  const toeMat = shinMat;
  const toeDefs = [
    { a: 0.0, l: 0.075 },   // front-center
    { a: 0.7, l: 0.06 },    // front-right
    { a: -0.7, l: 0.06 },   // front-left
    { a: Math.PI, l: 0.05 },// hind (hallux)
  ];
  for (const t of toeDefs) {
    const toe = new THREE.Group();
    toe.rotation.y = t.a;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, t.l, 8), toeMat);
    seg.rotation.x = Math.PI / 2;
    seg.rotation.x += 0.25;
    seg.position.set(0, -0.005, t.l * 0.45);
    toe.add(seg);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.03, 8), talonMat);
    claw.rotation.x = Math.PI * 0.75;
    claw.position.set(0, -0.02, t.l * 0.86);
    toe.add(claw);
    foot.add(toe);
  }

  return { hip, knee, ankle, foot };
}

// ------- full eagle --------------------------------------------------------
export function buildEagle() {
  const root = new THREE.Group();
  root.name = 'eagle';

  // body core group (bob / lean without moving the world root)
  const body = new THREE.Group();
  root.add(body);

  const torsoMat = std(COL.bodyMid, { rough: 0.82 });
  const breastMat = std(COL.breast, { rough: 0.82 });

  // torso — streamlined ellipsoid, breast forward & belly
  const torso = ellipsoid(0.16, 0.17, 0.34, torsoMat, 32);
  torso.position.set(0, 0, 0);
  body.add(torso);

  const breast = ellipsoid(0.15, 0.15, 0.18, breastMat, 28);
  breast.position.set(0, -0.02, 0.16);
  body.add(breast);

  // back / mantle overlay slightly darker
  const mantle = ellipsoid(0.155, 0.12, 0.22, std(COL.bodyDark), 24);
  mantle.position.set(0, 0.07, 0.02);
  body.add(mantle);

  // scatter body contour feathers for texture on breast/back
  const contour = [];
  const contourMat = [std(COL.bodyMid), std(COL.bodyDark), std(COL.breast)];
  for (let i = 0; i < 90; i++) {
    const f = makeFeather(0.09, 0.045, contourMat[i % 3], { asym: 0.5, curl: 0.03 });
    // distribute over an ellipsoid surface
    const v = Math.acos(1 - 2 * ((i + 0.5) / 90));
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    let nx = Math.sin(v) * Math.cos(phi);
    let ny = Math.cos(v);
    let nz = Math.sin(v) * Math.sin(phi);
    // bias to sides/back/breast, skip very top (wings) and bottom seam
    const px = nx * 0.17, py = ny * 0.17, pz = nz * 0.32;
    f.position.set(px, py, pz);
    // orient feather to lie along body pointing backward & downward over surface
    f.lookAt(px * 3, py * 3 - 0.5, pz * 3 - 1.0);
    f.rotateY(Math.PI / 2);
    f.userData.base = { x: f.rotation.x, y: f.rotation.y, z: f.rotation.z };
    body.add(f);
    contour.push(f);
  }

  // ---- neck + head ----
  const neck = new THREE.Group();
  neck.position.set(0, 0.10, 0.24);
  body.add(neck);
  const neckMesh = limb(0.09, 0.085, 0.10, std(COL.white, { rough: 0.85 }));
  neckMesh.rotation.x = -0.5;
  neckMesh.position.set(0, 0.05, 0.03);
  neck.add(neckMesh);

  const { head, jaw, beak } = buildHead();
  head.position.set(0, 0.12, 0.10);
  neck.add(head);

  // ---- tail ----
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, -0.30);
  body.add(tail);
  const tailFeathers = [];
  const NT = 12;
  const tailWhite = std(COL.white, { rough: 0.85 });
  for (let i = 0; i < NT; i++) {
    const u = (i / (NT - 1)) - 0.5;          // -0.5 .. 0.5
    const len = 0.34 - Math.abs(u) * 0.05;
    const f = makeFeather(len, 0.07, tailWhite, { asym: 0.5 + u * 0.1, curl: 0.03, thick: 0.007 });
    f.rotation.y = Math.PI * 0.5 + u * 0.5;   // fan in Z toward -Z (built along +X => back)
    f.rotation.z = -0.05;
    // dark terminal band tip
    f.userData.base = { x: 0, y: f.rotation.y, z: -0.05 };
    f.userData.fanU = u;
    tail.add(f);
    tailFeathers.push(f);
  }

  // ---- wings ----
  const wingsR = buildWing('R');
  const wingsL = buildWing('L');
  wingsR.shoulder.position.set(0.12, 0.10, 0.02);
  wingsL.shoulder.position.set(-0.12, 0.10, 0.02);
  wingsL.shoulder.scale.x = -1; // mirror; identical rotations produce symmetric motion
  body.add(wingsR.shoulder);
  body.add(wingsL.shoulder);

  // ---- legs ----
  const legR = buildLeg('R');
  const legL = buildLeg('L');
  legR.hip.position.set(0.07, -0.10, 0.02);
  legL.hip.position.set(-0.07, -0.10, 0.02);
  body.add(legR.hip);
  body.add(legL.hip);

  // shadows for all meshes
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  const rig = {
    root, body, neck, head, jaw, beak, tail, tailFeathers, contour,
    wings: { R: wingsR, L: wingsL },
    legs: { R: legR, L: legL },
  };

  // store rest transforms we mutate
  rig.rest = {
    bodyPos: body.position.clone(),
    bodyRot: body.rotation.clone(),
    neckRot: neck.rotation.clone(),
    headRot: head.rotation.clone(),
    tailRot: tail.rotation.clone(),
  };

  return rig;
}

export { COL };
