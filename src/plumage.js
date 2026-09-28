/**
 * plumage.js — body shells and feather tracts for Haliaeetus leucocephalus.
 *
 * Feather counts / topography follow the real bird:
 *   10 primaries  (P1-P10) on the carpometacarpus + major digit, the outer
 *                 6 emarginated so the tips separate into "fingers"
 *   17 secondaries on the ulna (attached at the quill knobs)
 *    4 tertials near the elbow
 *   greater / median / lesser / marginal upper coverts, plus underwing coverts
 *    4 alula feathers on the alular digit
 *   12 rectrices on the pygostyle (white in the adult)
 * Adult colouring: white head, neck and tail; blackish-brown body and wings;
 * yellow cere, bill, tarsi and feet; pale yellow iris.
 *
 * Everything is parented to the skeleton's joint nodes, so the plumage
 * deforms from the bone animation rather than being animated separately.
 */
import * as THREE from 'three';

const D = Math.PI / 180;

export const COL = {
  brown: 0x3a2b1f,
  brownDark: 0x241a12,
  brownWarm: 0x4d3927,
  white: 0xf3f0e8,
  whiteDim: 0xdedace,
  yellow: 0xe9a81c,
  yellowPale: 0xf2c94c,
  iris: 0xe8d98a,
  black: 0x111111,
};

function mat(color, rough = 0.78, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0.0, side: THREE.DoubleSide, ...extra,
  });
}

export const MATS = {
  brown: mat(COL.brown, 0.85),
  brownDark: mat(COL.brownDark, 0.85),
  brownWarm: mat(COL.brownWarm, 0.85),
  white: mat(COL.white, 0.8),
  whiteDim: mat(COL.whiteDim, 0.82),
  skin: mat(COL.yellow, 0.55),
  skinPale: mat(COL.yellowPale, 0.5),
  iris: mat(COL.iris, 0.25, { emissive: 0x2a2410, emissiveIntensity: 0.4 }),
  pupil: mat(COL.black, 0.15),
};

/* ------------------------------------------------------------------ */
/* feather geometry                                                    */
/* ------------------------------------------------------------------ */

/**
 * A single feather: cambered 3D vane shell + rachis tube.
 * Shaft runs along +X. Leading vane toward +Z, trailing vane toward -Z.
 * Camber lifts the vane in +Y so the feather is a genuine curved surface.
 */
export function makeFeather(o) {
  const L = o.length;
  // A real remex keeps almost full width from the calamus to ~85% of its
  // length and then rounds off, so neighbouring feathers overlap into a
  // continuous surface instead of splaying into gaps.
  const shape = (t) => {
    const grow = THREE.MathUtils.smoothstep(t, 0.0, 0.16);
    const round = 1 - Math.pow(THREE.MathUtils.smoothstep(t, 0.80, 1.0), 1.4);
    return grow * (0.78 + 0.22 * Math.sin(t * Math.PI)) * round;
  };
  const lead = o.lead || ((t) => 0.42 * o.chord * shape(t));
  const trail = o.trail || ((t) => o.chord * shape(t));
  const camber = o.camber ?? 0.22;
  const droop = o.droop ?? 0.06;          // fraction of L the tip sags
  const sweepBack = o.sweepBack ?? 0.05;  // fraction of L the tip trails
  const nu = o.nu || 26, nv = o.nv || 9;
  const notch = o.notch ?? 0;             // emargination of outer primaries

  const pos = [], nor = [], idx = [], uvs = [];
  const vane = (t, s) => {
    // s in [-1,1]: -1 = trailing edge, +1 = leading edge
    let wl = lead(t), wt = trail(t);
    if (notch > 0) {
      // sharp step narrowing near the tip -> slotted primary "finger"
      const k = THREE.MathUtils.smoothstep(t, o.notchAt ?? 0.62, (o.notchAt ?? 0.62) + 0.10);
      wl *= 1 - notch * 0.85 * k;
      wt *= 1 - notch * k;
    }
    return s >= 0 ? s * wl : s * wt;
  };
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    const x = t * L;
    const yBase = -droop * L * Math.pow(t, 2.1);
    const zBase = -sweepBack * L * Math.pow(t, 1.6);
    for (let j = 0; j <= nv; j++) {
      const s = (j / nv) * 2 - 1;
      const z = vane(t, s);
      const y = yBase + camber * Math.abs(z) * (0.35 + 0.65 * Math.abs(s));
      pos.push(x, y, zBase + z);
      nor.push(0, 1, 0);
      uvs.push(t, (s + 1) * 0.5);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const grp = new THREE.Group();
  const vaneMesh = new THREE.Mesh(g, o.material);
  vaneMesh.castShadow = true;
  grp.add(vaneMesh);

  // rachis (shaft) — tapered tube giving the feather real thickness
  const shaftPts = [];
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * 0.96;   // the rachis never protrudes past the vane
    shaftPts.push(new THREE.Vector3(t * L, -droop * L * Math.pow(t, 2.1),
      -sweepBack * L * Math.pow(t, 1.6)));
  }
  const shaftCurve = new THREE.CatmullRomCurve3(shaftPts);
  const shaft = new THREE.Mesh(
    new THREE.TubeGeometry(shaftCurve, 16, Math.max(0.0008, o.chord * 0.022), 6, false),
    o.shaftMaterial || MATS.whiteDim);
  shaft.scale.y = 0.9;
  grp.add(shaft);

  // dark tip band (primaries/secondaries of an adult are blackish at the tip)
  if (o.tipMaterial) {
    const tipG = g.clone();
    const p = tipG.attributes.position;
    const keep = [];
    const index = tipG.getIndex().array;
    for (let i = 0; i < index.length; i += 3) {
      const x = p.getX(index[i]);
      if (x > L * (o.tipFrom ?? 0.78)) keep.push(index[i], index[i + 1], index[i + 2]);
    }
    if (keep.length) {
      tipG.setIndex(keep);
      const tip = new THREE.Mesh(tipG, o.tipMaterial);
      tip.scale.setScalar(1.004);
      grp.add(tip);
    }
  }
  return grp;
}

/* Attach helper: creates an animatable node holding one feather. */
function attach(parent, name, pos, rot, feather, store, meta) {
  const n = new THREE.Object3D();
  n.name = name;
  n.position.set(...pos);
  n.rotation.set(rot[0], rot[1], rot[2], 'ZYX');
  n.userData.rest = n.quaternion.clone();
  n.add(feather);
  parent.add(n);
  store.push(Object.assign({ node: n, name }, meta));
  return n;
}

/* ------------------------------------------------------------------ */
/* wing plumage                                                        */
/* ------------------------------------------------------------------ */

function buildWingPlumage(rig, side, feathers) {
  const J = rig.joints;
  const wrist = J['wrist' + side], elbow = J['elbow' + side];
  const shoulder = J['shoulder' + side], digit = J['digit' + side];
  const alula = J['alula' + side];
  const CMC = 0.095;

  /* --- 10 primaries: P1..P6 on the carpometacarpus, P7..P10 on digit II ---
     Real bald eagle primary lengths run ~0.30 m (P1) to ~0.52 m (P7/P8),
     with the outermost slightly shorter. Outer six are emarginated. */
  const primL = [0.300, 0.330, 0.366, 0.406, 0.448, 0.482, 0.505, 0.512, 0.492, 0.442];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const onDigit = i >= 6;
    const parent = onDigit ? digit : wrist;
    const along = onDigit ? (i - 6) / 4 * 0.046 + 0.004 : 0.012 + (i / 6) * CMC * 0.92;
    const f = makeFeather({
      length: primL[i],
      chord: 0.082 - 0.014 * t,
      camber: 0.20,
      droop: 0.10 + 0.05 * t,
      sweepBack: 0.05,
      notch: i >= 4 ? 0.52 + 0.08 * (i - 4) / 5 : 0,
      notchAt: 0.58,
      material: MATS.brownDark,
      shaftMaterial: MATS.brownWarm,
      tipMaterial: MATS.brownDark,
      nu: 30, nv: 9,
    });
    // outer primaries point outboard, inner ones sweep progressively aft
    const sweep = (48 - 22 * t) * D;
    attach(parent, `P${i + 1}${side}`, [along, -0.004, -0.006],
      [(-6 - 4 * t) * D, sweep, (-3 + 2 * t) * D], f, feathers,
      { kind: 'primary', idx: i, n: 10, side, span: 0.55 + 0.45 * t });
  }

  /* --- 17 secondaries along the ulna, attached at the quill knobs --- */
  const ULNA = 0.234;
  for (let i = 0; i < 17; i++) {
    const t = i / 16;                       // 0 = outer (next to wrist)
    const f = makeFeather({
      length: 0.315 - 0.045 * t,
      chord: 0.094 - 0.010 * t,
      camber: 0.26,
      droop: 0.10,
      sweepBack: 0.04,
      material: MATS.brownDark,
      shaftMaterial: MATS.brownWarm,
      nu: 22, nv: 9,
    });
    attach(elbow, `S${i + 1}${side}`,
      [ULNA * (0.96 - 0.055 * i) - 0.004, -0.004, -0.010],
      [-8 * D, (74 + 6 * t) * D, -4 * D], f, feathers,
      { kind: 'secondary', idx: i, n: 17, side, span: 0.45 - 0.35 * t });
  }

  /* --- 4 tertials, rooted on the humerus near the body --- */
  for (let i = 0; i < 4; i++) {
    const f = makeFeather({
      length: 0.245 - 0.030 * i, chord: 0.098, camber: 0.28, droop: 0.12,
      material: MATS.brownWarm, shaftMaterial: MATS.brown, nu: 18, nv: 8,
    });
    attach(shoulder, `T${i + 1}${side}`, [0.130 - i * 0.030, -0.004, -0.012],
      [-10 * D, (84 + i * 4) * D, -6 * D], f, feathers,
      { kind: 'tertial', idx: i, n: 4, side, span: 0.16 });
  }

  /* --- greater upper coverts (one per secondary / outer primary) --- */
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const f = makeFeather({
      length: 0.150 - 0.025 * t, chord: 0.070, camber: 0.30, droop: 0.10,
      material: MATS.brown, shaftMaterial: MATS.brownWarm, nu: 14, nv: 7,
    });
    attach(elbow, `GC${i}${side}`, [ULNA * (0.94 - 0.060 * i) + 0.004, 0.004, -0.004],
      [-6 * D, 70 * D, 8 * D], f, feathers,
      { kind: 'covert', idx: i, n: 14, side, span: 0.3 });
  }
  for (let i = 0; i < 8; i++) {
    const f = makeFeather({
      length: 0.170 - 0.008 * i, chord: 0.062, camber: 0.28, droop: 0.10,
      material: MATS.brown, shaftMaterial: MATS.brownWarm, nu: 14, nv: 7,
    });
    attach(wrist, `PC${i}${side}`, [0.014 + i * 0.011, 0.004, 0.000],
      [-5 * D, 52 * D, 8 * D], f, feathers,
      { kind: 'covert', idx: i, n: 8, side, span: 0.5 });
  }

  /* --- median + lesser coverts: shorter, shingled rows toward the leading edge --- */
  for (let row = 0; row < 3; row++) {
    const count = 12 - row * 2;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const f = makeFeather({
        length: 0.105 - row * 0.028, chord: 0.052 - row * 0.008,
        camber: 0.32, droop: 0.08,
        material: row === 0 ? MATS.brown : MATS.brownWarm,
        shaftMaterial: MATS.brown, nu: 10, nv: 6,
      });
      attach(elbow, `MC${row}_${i}${side}`,
        [ULNA * (0.92 - 0.072 * i) + 0.010 + row * 0.004, 0.008 + row * 0.006, 0.006 + row * 0.008],
        [-4 * D, (66 - row * 6) * D, (14 + row * 8) * D], f, feathers,
        { kind: 'covert', idx: i, n: count, side, span: 0.2 });
    }
  }
  // marginal coverts along the leading edge (propatagium)
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const f = makeFeather({
      length: 0.070, chord: 0.038, camber: 0.3, droop: 0.05,
      material: MATS.brownWarm, shaftMaterial: MATS.brown, nu: 8, nv: 5,
    });
    attach(shoulder, `LC${i}${side}`, [0.03 + t * 0.16, 0.006, 0.014 + 0.010 * Math.sin(t * Math.PI)],
      [0, 40 * D, 26 * D], f, feathers, { kind: 'covert', idx: i, n: 10, side, span: 0.2 });
  }

  /* --- scapulars: the tract that closes the gap between body and wing --- */
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const f = makeFeather({
      length: 0.165 - 0.030 * t, chord: 0.070, camber: 0.30, droop: 0.10,
      material: MATS.brown, shaftMaterial: MATS.brownWarm, nu: 12, nv: 7,
    });
    attach(shoulder, `SC${i}${side}`, [-0.010 + i * 0.012, 0.012 - 0.002 * i, -0.014 - 0.006 * i],
      [-4 * D, (92 + 6 * t) * D, 12 * D], f, feathers,
      { kind: 'tertial', idx: i + 4, n: 7, side, span: 0.1 });
  }

  /* --- alula: 4 small stiff feathers on the "thumb" (leading-edge slat) --- */
  for (let i = 0; i < 4; i++) {
    const f = makeFeather({
      length: 0.088 - i * 0.012, chord: 0.038, camber: 0.24, droop: 0.06,
      material: MATS.brownDark, shaftMaterial: MATS.brownWarm, nu: 10, nv: 6,
    });
    attach(alula, `AL${i}${side}`, [0.006 + i * 0.008, 0.001, 0.002],
      [0, (40 + i * 6) * D, 4 * D], f, feathers,
      { kind: 'alula', idx: i, n: 4, side, span: 0.9 });
  }

  /* --- underwing coverts (thin, paler) --- */
  for (let i = 0; i < 10; i++) {
    const f = makeFeather({
      length: 0.130 - 0.006 * i, chord: 0.058, camber: -0.26, droop: -0.04,
      material: MATS.brown, shaftMaterial: MATS.brownWarm, nu: 10, nv: 6,
    });
    attach(elbow, `UC${i}${side}`, [ULNA * (0.90 - 0.085 * i) + 0.004, -0.010, -0.002],
      [6 * D, 68 * D, -16 * D], f, feathers,
      { kind: 'covert', idx: i, n: 10, side, span: 0.25 });
  }
}

/* ------------------------------------------------------------------ */
/* body shells                                                         */
/* ------------------------------------------------------------------ */

/** Loft a closed surface through elliptical cross-sections along +Z. */
function loft(sections, material, opt = {}) {
  const nv = opt.nv || 18;
  const pos = [], idx = [], uvs = [];
  const n = sections.length;
  for (let i = 0; i < n; i++) {
    const s = sections[i];
    for (let j = 0; j <= nv; j++) {
      const a = (j / nv) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      // superellipse keeps the breast full and the back rounded
      const p = opt.power || 2.0;
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      const sy = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p);
      const ry = sy >= 0 ? (s.up ?? s.r) : (s.down ?? s.r);
      pos.push(s.x0 + sx * s.w, s.y + sy * ry, s.z);
      uvs.push(j / nv, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function buildTorso(rig) {
  // thorax-local Z: +Z cranial. Breast at z≈0.15, tail base at z≈-0.16
  const S = [];
  const prof = [
    // z,     width, up,    down,  ycentre
    [-0.175, 0.020, 0.018, 0.016, -0.006],
    [-0.150, 0.042, 0.035, 0.034, -0.010],
    [-0.115, 0.064, 0.050, 0.055, -0.016],
    [-0.075, 0.076, 0.056, 0.076, -0.020],
    [-0.030, 0.082, 0.058, 0.094, -0.022],
    [0.010, 0.080, 0.056, 0.100, -0.022],
    [0.050, 0.074, 0.052, 0.098, -0.020],
    [0.085, 0.064, 0.048, 0.088, -0.016],
    [0.115, 0.052, 0.043, 0.070, -0.010],
    [0.140, 0.040, 0.036, 0.048, -0.002],
    [0.158, 0.028, 0.028, 0.030, 0.008],
    [0.168, 0.018, 0.020, 0.018, 0.016],
  ];
  for (const p of prof) S.push({ z: p[0], w: p[1], up: p[2], down: p[3], y: p[4], x0: 0, r: p[1] });
  const m = loft(S, MATS.brown, { nv: 24, power: 2.3 });
  rig.joints.thorax.add(m);
  return m;
}

const lerpN = (a, b, t) => a + (b - a) * t;

function buildNeck(rig) {
  // one tapered sleeve per cervical vertebra -> the neck bends with the spine
  const parts = [];
  const n = rig.neck.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const len = 0.0200 - 0.0062 * t;
    const rad = (u) => 0.062 - 0.030 * Math.pow(u, 1.25);
    const r0 = rad(t), r1 = rad(Math.min(1, (i + 1) / (n - 1)));
    // sleeves overlap generously so the bent neck stays a smooth surface
    const S = [];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5;
      const z = -len * 0.55 + u * len * 2.1;
      const r = lerpN(r0, r1, u) * (0.94 + 0.10 * Math.sin(u * Math.PI));
      S.push({ z, w: r, up: r * 0.96, down: r * 1.04, y: -0.004, x0: 0, r });
    }
    // hackles: brown at the base, blending to the white head over C1..C6
    const m = loft(S, t > 0.40 ? MATS.white : (t > 0.24 ? MATS.whiteDim : MATS.brown),
      { nv: 20, power: 2.1 });
    rig.neck[i].add(m);
    parts.push(m);
  }
  return parts;
}

function buildHead(rig) {
  const skull = rig.joints.skull;
  const g = new THREE.Group();
  skull.add(g);
  // feathered cranium (authored along +Z, matching the neck frame)
  const S = [
    { z: -0.030, w: 0.030, up: 0.026, down: 0.028, y: 0.000, x0: 0, r: 0.03 },
    { z: -0.012, w: 0.037, up: 0.033, down: 0.034, y: 0.002, x0: 0, r: 0.037 },
    { z: 0.008, w: 0.038, up: 0.034, down: 0.032, y: 0.004, x0: 0, r: 0.038 },
    { z: 0.028, w: 0.034, up: 0.030, down: 0.028, y: 0.004, x0: 0, r: 0.034 },
    { z: 0.046, w: 0.026, up: 0.023, down: 0.022, y: 0.004, x0: 0, r: 0.026 },
    { z: 0.058, w: 0.019, up: 0.017, down: 0.016, y: 0.003, x0: 0, r: 0.019 },
  ];
  g.add(loft(S, MATS.white, { nv: 18, power: 2.2 }));

  // eyes set in the big forward-facing orbits, with a heavy brow
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 20, 16), MATS.iris);
    eye.position.set(s * 0.0255, 0.008, 0.037);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 16, 12), MATS.pupil);
    pupil.position.set(s * 0.0305, 0.0085, 0.0435);
    g.add(pupil);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), MATS.white);
    brow.scale.set(0.011, 0.007, 0.020);
    brow.position.set(s * 0.024, 0.019, 0.038);
    g.add(brow);
  }
  // fleshy cere / gape around the bill base
  const cere = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), MATS.skin);
  cere.scale.set(0.014, 0.012, 0.014);
  cere.position.set(0, 0.006, 0.058);
  g.add(cere);
  return g;
}

function buildTail(rig, feathers) {
  const pyg = rig.joints.pygostyle;
  // 12 rectrices; adult bald eagle tail is white with a dark terminal edge
  for (let i = 0; i < 12; i++) {
    const k = i - 5.5;                      // -5.5 .. 5.5
    const t = Math.abs(k) / 5.5;
    const f = makeFeather({
      length: 0.300 - 0.030 * t,
      chord: 0.070 - 0.008 * t,
      camber: 0.16,
      droop: 0.05,
      sweepBack: 0.0,
      material: MATS.white,
      shaftMaterial: MATS.whiteDim,
      nu: 20, nv: 8,
    });
    // pygostyle frame: +Z cranial, so tail feathers point -Z (yaw +90 deg)
    const n = new THREE.Object3D();
    n.rotation.set(0, Math.PI / 2, 0, 'ZYX');
    n.position.set(k * 0.0035, 0.002 - Math.abs(k) * 0.0006, -0.004);
    n.userData.rest = n.quaternion.clone();
    n.userData.fanSign = Math.sign(k) || 1;
    n.userData.fanT = t;
    n.add(f);
    pyg.add(n);
    feathers.push({ node: n, kind: 'rectrix', idx: i, n: 12, k, side: k < 0 ? '.L' : '.R' });
  }
  // upper + under tail coverts
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const f = makeFeather({
      length: 0.100, chord: 0.048, camber: 0.2, droop: 0.05,
      material: MATS.white, shaftMaterial: MATS.whiteDim, nu: 10, nv: 6,
    });
    const n = new THREE.Object3D();
    n.rotation.set(0, Math.PI / 2 - s * (0.12 + 0.05 * i) , 0.10, 'ZYX');
    n.position.set(s * 0.008 * (1 + i * 0.2), 0.012, 0.004);
    n.userData.rest = n.quaternion.clone();
    n.add(f);
    rig.joints.caudal2.add(n);
    feathers.push({ node: n, kind: 'tailCovert', idx: i, n: 6 });
  }
}

function buildLegFlesh(rig, side) {
  const J = rig.joints;
  // feathered thigh + "trousers" over the drumstick
  const thigh = loft([
    { z: 0, w: 0.030, up: 0.028, down: 0.030, y: 0, x0: 0, r: 0.03 },
    { z: 0.055, w: 0.034, up: 0.032, down: 0.034, y: 0, x0: 0, r: 0.034 },
    { z: 0.100, w: 0.026, up: 0.024, down: 0.026, y: 0, x0: 0, r: 0.026 },
  ], MATS.brown, { nv: 14 });
  thigh.rotation.y = Math.PI / 2;   // hip frame: bone runs +X
  J['hip' + side].add(thigh);

  const crus = loft([
    { z: 0, w: 0.032, up: 0.030, down: 0.032, y: 0, x0: 0, r: 0.032 },
    { z: 0.060, w: 0.030, up: 0.028, down: 0.030, y: 0, x0: 0, r: 0.03 },
    { z: 0.110, w: 0.020, up: 0.019, down: 0.020, y: 0, x0: 0, r: 0.02 },
    { z: 0.145, w: 0.012, up: 0.012, down: 0.012, y: 0, x0: 0, r: 0.012 },
  ], MATS.brown, { nv: 14 });
  crus.rotation.y = Math.PI / 2;
  J['knee' + side].add(crus);

  // bare yellow, scaled tarsus
  const tars = loft([
    { z: 0, w: 0.013, up: 0.013, down: 0.013, y: 0, x0: 0, r: 0.013 },
    { z: 0.045, w: 0.010, up: 0.010, down: 0.010, y: 0, x0: 0, r: 0.01 },
    { z: 0.088, w: 0.012, up: 0.012, down: 0.012, y: 0, x0: 0, r: 0.012 },
  ], MATS.skin, { nv: 12 });
  tars.rotation.y = Math.PI / 2;
  J['ankle' + side].add(tars);

  // fleshy toes over the phalanges
  for (const t of ['I', 'II', 'III', 'IV']) {
    let n = J[`toe${t}${side}`];
    let i = 0, r = 0.0085;
    while (n) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), MATS.skin);
      const len = (t === 'I' ? 0.030 : t === 'II' ? 0.026 : t === 'III' ? 0.024 : 0.019)
        * Math.pow(t === 'I' ? 0.80 : 0.78, i);
      seg.scale.set(len * 0.6, r, r);
      seg.position.set(len * 0.45, 0, 0);
      n.add(seg);
      n = n.children.find((c) => c.name && c.name.startsWith(`toe${t}${side}_`));
      i++; r *= 0.87;
    }
  }
}

/* ------------------------------------------------------------------ */

export function buildPlumage(rig) {
  const feathers = [];
  buildTorso(rig);
  buildNeck(rig);
  buildHead(rig);
  buildTail(rig, feathers);
  for (const s of ['.R', '.L']) {
    buildWingPlumage(rig, s, feathers);
    buildLegFlesh(rig, s);
  }
  // breast / scapular contour feather cards for silhouette break-up
  const contour = [];
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const s = i % 2 ? 1 : -1;
    const f = makeFeather({
      length: 0.075 + 0.02 * Math.sin(t * Math.PI), chord: 0.048,
      camber: 0.3, droop: 0.08, material: MATS.brownWarm,
      shaftMaterial: MATS.brown, nu: 8, nv: 5,
    });
    const n = new THREE.Object3D();
    n.position.set(s * (0.020 + 0.050 * Math.sin(t * Math.PI)),
      -0.010 + 0.050 * Math.cos(t * Math.PI * 0.9), 0.130 - t * 0.28);
    n.rotation.set(0, Math.PI - s * 0.5, -2.1, 'ZYX');
    n.userData.rest = n.quaternion.clone();
    n.add(f);
    rig.joints.thorax.add(n);
    feathers.push({ node: n, kind: 'contour', idx: i, n: 26 });
    contour.push(n);
  }

  rig.feathers = feathers;
  // tag plumage so the viewer can toggle between skeleton and full bird
  rig.root.traverse((o) => {
    if (o.isMesh && !o.userData.isBone) o.userData.isFlesh = true;
  });
  return feathers;
}
