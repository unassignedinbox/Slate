/**
 * skeleton.js — anatomically measured Haliaeetus leucocephalus (bald eagle) skeleton.
 *
 * Osteometrics (metres) taken from the Royal BC Museum Avian Osteology
 * reference collection means for Haliaeetus leucocephalus, plus Trail (2017)
 * "Identifying Bald versus Golden Eagle bones" long-bone tables:
 *
 *   humerus          0.205   (RBCM mean 200.2 M / 214.7 F mm)
 *   ulna             0.234   (Trail mean 233.5 mm)
 *   radius           0.221
 *   carpometacarpus  0.095
 *   digit II ph1     0.046   ph2 0.023
 *   digit III ph1    0.014
 *   alular digit     0.034
 *   coracoid         0.080   (Trail mean 79.6 mm)
 *   scapula          0.112
 *   sternum          0.132   keel depth 0.048
 *   femur            0.113   (RBCM mean 113.3 mm)
 *   tibiotarsus      0.151   (RBCM mean 150.9 mm)
 *   tarsometatarsus  0.088   (RBCM mean 87.6 mm)
 *   skull            0.108   overall, cranium 0.062 + rhamphotheca
 *   cervical count   14      (raptor formula — allows >180 deg head turn)
 *   thoracic         5 (notarium-fused) + synsacrum + 5 free caudals + pygostyle
 *   ribs             7 pairs, 5 sternal, uncinate processes on ribs 2-6
 *
 * Axes: +X = the bird's right, +Y = up, +Z = forward (cranial).
 * Limbs are authored on the +X side and the left side is instantiated inside a
 * scale.x = -1 group, so identical local joint angles give true bilateral
 * mirroring (flexion about X is preserved, ab/adduction about Y/Z is mirrored).
 */
import * as THREE from 'three';
import {
  boneTube, blob, plate, node, longBoneProfile, bump,
  BONE_MAT, CARTILAGE_MAT, KERATIN_MAT, CLAW_MAT,
} from './bonegeo.js';

const D = Math.PI / 180;

export const MEASURE = {
  humerus: 0.205, ulna: 0.234, radius: 0.221, cmc: 0.095,
  d2p1: 0.046, d2p2: 0.023, d3p1: 0.014, alula: 0.034,
  coracoid: 0.080, scapula: 0.112, sternum: 0.132, keel: 0.048,
  femur: 0.113, tibiotarsus: 0.151, tarsometatarsus: 0.088,
  cranium: 0.062, beak: 0.055, neck: 0.215,
};

/* ------------------------------------------------------------------ */
/* vertebrae                                                           */
/* ------------------------------------------------------------------ */

function vertebra(len, rCentrum, spineH, tpW, opt = {}) {
  const g = new THREE.Group();
  // centrum — heterocoelous (saddle) in birds; modelled as a waisted spool
  const c = boneTube(len, longBoneProfile(rCentrum * 1.25, rCentrum * 0.72, rCentrum * 1.25, 2.6));
  g.add(c);
  // neural arch + spinous process
  if (spineH > 0) {
    const s = boneTube(spineH, longBoneProfile(rCentrum * 0.55, rCentrum * 0.3, rCentrum * 0.42, 1.6),
      (t) => [0, 0]);
    s.rotation.z = Math.PI / 2;
    s.position.set(len * 0.45, rCentrum * 0.85, 0);
    g.add(s);
    if (opt.spineBlade) {
      const bl = blob(len * 0.30, spineH * 0.52, rCentrum * 0.12,
        len * 0.45, rCentrum * 0.85 + spineH * 0.5, 0);
      g.add(bl);
    }
  }
  // neural canal arch
  g.add(blob(len * 0.30, rCentrum * 0.62, rCentrum * 0.70, len * 0.45, rCentrum * 0.72, 0));
  // transverse processes (costal in the neck, rib-bearing in thorax)
  for (const s of [-1, 1]) {
    const tp = boneTube(tpW, longBoneProfile(rCentrum * 0.42, rCentrum * 0.22, rCentrum * 0.30, 1.4));
    tp.rotation.y = -s * Math.PI / 2;
    tp.rotation.z = -12 * D;
    tp.position.set(len * 0.40, rCentrum * 0.25, 0);
    g.add(tp);
  }
  // pre/post-zygapophyses
  for (const s of [-1, 1]) {
    g.add(blob(rCentrum * 0.3, rCentrum * 0.2, rCentrum * 0.22, len * 0.03, rCentrum * 0.85, s * rCentrum * 0.55));
    g.add(blob(rCentrum * 0.3, rCentrum * 0.2, rCentrum * 0.22, len * 0.90, rCentrum * 0.85, s * rCentrum * 0.55));
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* skull                                                               */
/* ------------------------------------------------------------------ */

function buildSkull(parent) {
  const skull = node('skull', parent);
  // the neck chain runs along +Z (cranially); skull parts are authored along +X
  const g = new THREE.Group();
  g.rotation.y = -Math.PI / 2;
  skull.add(g);
  const L = MEASURE.cranium;

  // braincase
  g.add(blob(L * 0.40, L * 0.35, L * 0.36, L * 0.16, 0.004, 0));
  g.add(blob(L * 0.24, L * 0.26, L * 0.30, L * 0.44, 0.004, 0));      // frontal
  g.add(blob(L * 0.22, L * 0.20, L * 0.22, -L * 0.14, -0.004, 0));    // occiput
  // occipital condyle (single, ball joint — lets the head swivel far)
  g.add(blob(0.006, 0.006, 0.006, -L * 0.27, -L * 0.14, 0));
  // supraorbital ridges — the eagle's "scowl"
  for (const s of [-1, 1]) {
    g.add(plate([
      [L * 0.16, L * 0.26, s * L * 0.20],
      [L * 0.40, L * 0.30, s * L * 0.26],
      [L * 0.62, L * 0.24, s * L * 0.22],
      [L * 0.74, L * 0.14, s * L * 0.14],
    ], 0.0038));
    // orbital rim (huge orbit — eyes are ~2/3 of skull volume)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(L * 0.235, 0.0028, 8, 26), BONE_MAT);
    ring.rotation.y = Math.PI / 2;
    ring.rotation.x = 8 * D;
    ring.position.set(L * 0.47, L * 0.02, s * L * 0.20);
    g.add(ring);
    // jugal (zygomatic) bar — thin strut from maxilla to quadrate
    g.add(plate([
      [L * 0.10, -L * 0.20, s * L * 0.20],
      [L * 0.45, -L * 0.24, s * L * 0.19],
      [L * 0.80, -L * 0.20, s * L * 0.13],
      [L * 0.98, -L * 0.14, s * L * 0.08],
    ], 0.0026));
    // quadrate
    g.add(blob(0.007, 0.011, 0.006, L * 0.02, -L * 0.20, s * L * 0.20));
    // temporal fossa margin
    g.add(blob(L * 0.05, L * 0.13, 0.003, -L * 0.02, 0.0, s * L * 0.30));
  }
  // nares / craniofacial hinge region
  g.add(blob(L * 0.20, L * 0.13, L * 0.13, L * 0.86, L * 0.06, 0));

  /* upper beak — premaxilla + rhamphotheca, strongly decurved hook */
  const beakL = MEASURE.beak;
  const upper = boneTube(beakL,
    (t) => 0.0180 * (1 - t * 0.90) + 0.0016,
    (t) => [-0.056 * Math.pow(t, 2.45), 0],
    { mat: KERATIN_MAT, squashZ: 0.70, seg: 40 });
  upper.position.set(L * 0.98, L * 0.10, 0);
  upper.rotation.z = -6 * D;
  g.add(upper);
  // cere
  g.add(blob(0.010, 0.010, 0.011, L * 0.96, L * 0.13, 0, KERATIN_MAT));
  // tomial cutting edge
  g.add(plate([
    [L * 1.00, L * 0.03, 0.0035], [L * 1.30, -L * 0.02, 0.004],
    [L * 1.52, -L * 0.16, 0.0030], [L * 1.56, -L * 0.34, 0.0018],
  ], 0.0016, KERATIN_MAT));
  g.add(plate([
    [L * 1.00, L * 0.03, -0.0035], [L * 1.30, -L * 0.02, -0.004],
    [L * 1.52, -L * 0.16, -0.0030], [L * 1.56, -L * 0.34, -0.0018],
  ], 0.0016, KERATIN_MAT));

  /* mandible — hinged at the quadrate so it can gape for the screech */
  const jaw = node('mandible', g, [L * 0.02, -L * 0.20, 0]);
  for (const s of [-1, 1]) {
    const ramus = boneTube(beakL + L * 0.94,
      (t) => 0.0062 * (1 - 0.62 * t) + 0.0012,
      (t) => [-0.004 * t - 0.010 * Math.pow(t, 3), -s * 0.0125 * (1 - Math.pow(t, 1.5))],
      { mat: BONE_MAT, seg: 34 });
    ramus.position.set(0, 0, s * 0.0125);
    jaw.add(ramus);
    // retroarticular process
    jaw.add(blob(0.008, 0.005, 0.004, -0.008, -0.002, s * 0.0125));
  }
  // floor of the lower bill between the rami, plus the gonys
  const floor = boneTube(beakL + L * 0.92,
    (t) => 0.0135 * (1 - 0.55 * t) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.9)) + 0.0020,
    (t) => [-0.004 * t - 0.012 * Math.pow(t, 3), 0],
    { mat: KERATIN_MAT, squashY: 0.62, seg: 30 });
  jaw.add(floor);
  const gape = boneTube(beakL + L * 0.80, (t) => 0.0105 * (1 - 0.5 * t) + 0.001,
    (t) => [-0.004 * t + 0.004, 0],
    { mat: new THREE.MeshStandardMaterial({ color: 0x8d4a46, roughness: 0.6, side: THREE.DoubleSide }),
      squashY: 0.45, seg: 20 });
  jaw.add(gape);
  const tip = blob(0.010, 0.0085, 0.0070, beakL + L * 0.88, -0.012, 0, KERATIN_MAT);
  jaw.add(tip);

  skull.userData.jaw = jaw;
  return skull;
}

/* ------------------------------------------------------------------ */
/* wing (authored on +X)                                               */
/* ------------------------------------------------------------------ */

function buildWing(parent, rig, side) {
  const M = MEASURE;
  const sfx = side;

  // ---- pectoral girdle (rigid, attached to thorax, not animated) -----
  const girdle = new THREE.Group();
  parent.add(girdle);

  // coracoid: strut from sternum up to the glenoid
  const cor = boneTube(M.coracoid, longBoneProfile(0.0115, 0.0055, 0.0095, 2.0),
    (t) => [0, 0.004 * Math.sin(t * Math.PI)]);
  cor.position.set(0.012, -0.070, 0.028);
  cor.rotation.z = 64 * D; cor.rotation.y = -14 * D;
  girdle.add(cor);

  // scapula: sabre-shaped blade lying along the ribcage
  const sca = boneTube(M.scapula, (t) => 0.0085 * (1 - t) + 0.0032 + bump(t, 0.02, 0.12, 0.004),
    (t) => [0.006 * t, -0.018 * t * t], { squashZ: 0.45 });
  sca.position.set(0.026, 0.028, 0.024);
  sca.rotation.y = 176 * D; sca.rotation.z = -6 * D;
  girdle.add(sca);

  // furcula half (wishbone) — only build on right, mirrored group handles left
  const fur = boneTube(0.092, (t) => 0.0055 - 0.0022 * t,
    (t) => [-0.052 * t * t, 0.030 * t * t]);
  fur.position.set(0.020, 0.020, 0.036);
  fur.rotation.set(0, -52 * D, -8 * D);
  girdle.add(fur);

  // glenoid / triosseal canal
  girdle.add(blob(0.010, 0.009, 0.009, 0.030, 0.026, 0.030));

  // ---- shoulder joint ------------------------------------------------
  const shoulder = node('shoulder' + sfx, parent, [0.030, 0.026, 0.030]);

  /* HUMERUS — sigmoidal shaft, huge pneumatic proximal head with
     deltopectoral crest, bicipital crest and distal condyles. */
  const hum = boneTube(M.humerus,
    (t) => 0.0125 * Math.pow(1 - t, 1.9) + 0.0062 + 0.0032 * Math.pow(t, 6)
      + bump(t, 0.10, 0.13, 0.0075) + bump(t, 0.97, 0.10, 0.0028),
    (t) => [0.010 * Math.sin(t * Math.PI * 1.02) - 0.004 * t,
            -0.013 * Math.sin(t * Math.PI) + 0.006 * t],
    { seg: 44, squashY: 1.0, squashZ: 0.86 });
  shoulder.add(hum);
  shoulder.add(blob(0.0125, 0.010, 0.010, 0.004, 0.002, 0));            // caput humeri
  shoulder.add(blob(0.007, 0.010, 0.006, 0.020, 0.010, -0.009));        // deltopectoral crest
  shoulder.add(blob(0.0085, 0.0075, 0.0085, M.humerus - 0.004, 0.004, 0.004)); // dorsal condyle
  shoulder.add(blob(0.0075, 0.0065, 0.0070, M.humerus - 0.004, 0.000, -0.006)); // ventral condyle

  // ---- elbow ---------------------------------------------------------
  const elbow = node('elbow' + sfx, shoulder, [M.humerus - 0.004, 0.003, 0.002]);

  /* ULNA — the long, gently bowed caudal bone that carries the secondaries
     (quill knobs visible as a row of papillae along the caudal margin). */
  const uln = boneTube(M.ulna,
    (t) => 0.0088 * Math.pow(1 - t, 1.8) + 0.0052 + 0.0022 * Math.pow(t, 5)
      + bump(t, 0.03, 0.08, 0.0055),
    (t) => [0.002 * Math.sin(t * Math.PI), -0.0175 * Math.sin(t * Math.PI)],
    { seg: 44 });
  elbow.add(uln);
  elbow.add(blob(0.0075, 0.0085, 0.0062, 0.002, 0.002, -0.001));   // olecranon
  // quill knobs (papillae remigales) for the secondary feather follicles
  for (let i = 0; i < 12; i++) {
    const t = 0.18 + i * 0.062;
    const y = 0.002 * Math.sin(t * Math.PI);
    const z = -0.0175 * Math.sin(t * Math.PI);
    const r = 0.0088 * Math.pow(1 - t, 1.8) + 0.0052;
    elbow.add(blob(0.0022, 0.0018, 0.0026, t * M.ulna, y - r * 0.45, z - r * 0.80));
  }

  /* RADIUS — slimmer, cranial, slides against the ulna: this sliding pair
     is what mechanically couples elbow extension to wrist extension. */
  const rad = boneTube(M.radius,
    (t) => 0.0052 * Math.pow(1 - t, 1.6) + 0.0032 + 0.0018 * Math.pow(t, 5),
    (t) => [0.001 * Math.sin(t * Math.PI), 0.0135 * Math.sin(t * Math.PI)],
    { seg: 40 });
  rad.position.set(0.004, 0.001, 0.006);
  elbow.add(rad);

  // ---- carpus / wrist -------------------------------------------------
  const wrist = node('wrist' + sfx, elbow, [M.ulna - 0.002, 0.001, -0.004]);
  wrist.add(blob(0.0062, 0.0055, 0.0048, 0.002, 0.0, 0.004));  // os carpi radiale
  wrist.add(blob(0.0058, 0.0060, 0.0044, 0.001, 0.0, -0.004)); // os carpi ulnare

  /* CARPOMETACARPUS — fused metacarpals II+III with the intermetacarpal
     space; carries the primaries. */
  const cmcMajor = boneTube(M.cmc, (t) => 0.0055 - 0.0012 * Math.sin(t * Math.PI) + 0.0012 * Math.pow(t, 4),
    (t) => [0, 0.0015 * Math.sin(t * Math.PI)], { seg: 26 });
  cmcMajor.position.set(0.006, 0, 0.0045);
  wrist.add(cmcMajor);
  const cmcMinor = boneTube(M.cmc * 0.96, (t) => 0.0032 - 0.0006 * Math.sin(t * Math.PI),
    (t) => [0, -0.0055 * Math.sin(t * Math.PI)], { seg: 26 });
  cmcMinor.position.set(0.006, 0, -0.0035);
  wrist.add(cmcMinor);
  wrist.add(blob(0.0075, 0.0060, 0.0072, 0.005, 0.0, 0.001)); // carpal trochlea
  // primary quill knobs on the caudal edge of the CMC
  for (let i = 0; i < 6; i++) {
    const t = 0.18 + i * 0.14;
    wrist.add(blob(0.0018, 0.0015, 0.0020, 0.006 + t * M.cmc, -0.0012, -0.0075));
  }

  /* ALULAR DIGIT (digit I / "thumb") — the bastard wing, a leading-edge slat.
     Hinged separately: it deploys at high angle of attack and on landing. */
  const alula = node('alula' + sfx, wrist, [0.010, 0.001, 0.0075]);
  const al1 = boneTube(M.alula * 0.62, (t) => 0.0030 - 0.0011 * t, (t) => [0, 0.002 * t]);
  alula.add(al1);
  const al2 = boneTube(M.alula * 0.38, (t) => 0.0019 - 0.0008 * t);
  al2.position.set(M.alula * 0.60, 0, 0.002);
  al2.rotation.y = -10 * D;
  alula.add(al2);

  // ---- major digit (II) ------------------------------------------------
  const digit = node('digit' + sfx, wrist, [0.006 + M.cmc, 0, 0.002]);
  const p1 = boneTube(M.d2p1, (t) => 0.0042 - 0.0014 * t,
    (t) => [0, -0.0016 * t], { squashZ: 1.5, seg: 20 });
  digit.add(p1);
  const digitTip = node('digitTip' + sfx, digit, [M.d2p1, 0, -0.0016]);
  const p2 = boneTube(M.d2p2, (t) => 0.0026 * (1 - 0.72 * t), null, { seg: 14 });
  digitTip.add(p2);
  // minor digit (III) — single small phalanx off the caudal side of the CMC
  const d3 = boneTube(M.d3p1, (t) => 0.0022 * (1 - 0.5 * t));
  d3.position.set(0.001, 0, -0.0055);
  d3.rotation.y = 24 * D;
  digit.add(d3);

  rig.joints['shoulder' + sfx] = shoulder;
  rig.joints['elbow' + sfx] = elbow;
  rig.joints['wrist' + sfx] = wrist;
  rig.joints['digit' + sfx] = digit;
  rig.joints['digitTip' + sfx] = digitTip;
  rig.joints['alula' + sfx] = alula;
  return shoulder;
}

/* ------------------------------------------------------------------ */
/* hindlimb (authored on +X)                                           */
/* ------------------------------------------------------------------ */

function buildLeg(parent, rig, side) {
  const M = MEASURE;
  const sfx = side;

  /* HIP — in birds the femur is held nearly horizontal and largely buried in
     the body wall; the visible "knee" of a standing bird is the ankle
     (intertarsal joint). Rest pose reproduces the crouched raptor stance. */
  const hip = node('hip' + sfx, parent, [0.026, -0.010, -0.010], [0, -Math.PI / 2, 0]);
  const fem = boneTube(M.femur,
    (t) => 0.0085 * Math.pow(1 - t, 2.0) + 0.0055 + 0.0028 * Math.pow(t, 5)
      + bump(t, 0.06, 0.10, 0.004),
    (t) => [0.004 * Math.sin(t * Math.PI), 0.003 * Math.sin(t * Math.PI)],
    { seg: 30 });
  hip.add(fem);
  hip.add(blob(0.0085, 0.0085, 0.0085, 0.002, 0.001, 0));                 // caput femoris
  hip.add(blob(0.0075, 0.0080, 0.0068, M.femur - 0.004, 0.0, 0.004));     // lateral condyle
  hip.add(blob(0.0070, 0.0078, 0.0062, M.femur - 0.004, 0.0, -0.005));    // medial condyle

  // ---- knee ------------------------------------------------------------
  const knee = node('knee' + sfx, hip, [M.femur - 0.004, 0, 0]);
  const tib = boneTube(M.tibiotarsus,
    (t) => 0.0088 * Math.pow(1 - t, 2.2) + 0.0048 + 0.0018 * Math.pow(t, 6),
    (t) => [0.0035 * Math.sin(t * Math.PI), -0.002 * Math.sin(t * Math.PI)],
    { seg: 34 });
  knee.add(tib);
  knee.add(blob(0.0070, 0.0105, 0.0058, 0.004, 0.006, 0.001));  // cnemial crest
  // fibula — splinted along the lateral tibiotarsus, tapering to a spike
  const fib = boneTube(M.tibiotarsus * 0.62, (t) => 0.0030 * Math.pow(1 - t, 1.5) + 0.0006,
    (t) => [0, 0]);
  fib.position.set(0.006, 0.001, 0.0078);
  fib.rotation.y = -2.0 * D;
  knee.add(fib);
  knee.add(blob(0.0062, 0.0055, 0.0072, M.tibiotarsus - 0.003, 0, 0)); // condylus tibialis

  // ---- intertarsal (ankle) joint ---------------------------------------
  const ankle = node('ankle' + sfx, knee, [M.tibiotarsus - 0.003, 0, 0]);
  const tmt = boneTube(M.tarsometatarsus,
    (t) => 0.0082 * Math.pow(1 - t, 2.4) + 0.0050 + 0.0030 * Math.pow(t, 7),
    null, { seg: 26, squashZ: 0.80 });
  ankle.add(tmt);
  ankle.add(blob(0.0078, 0.0070, 0.0090, 0.003, 0, 0));
  // hypotarsus + the three distal trochleae
  ankle.add(blob(0.0050, 0.0045, 0.0075, 0.010, -0.004, 0));

  /* TOES — raptor phalangeal formula 2-3-4-5 (digits I..IV), each tipped
     with a recurved talon. Digit I (hallux) is reversed and bears the
     killing talon; digit II carries the next largest. */
  const toeSpec = [
    { name: 'I',   yaw: 180, n: 2, base: 0.030, taper: 0.80, claw: 0.038, spread: -2 },
    { name: 'II',  yaw: -26, n: 3, base: 0.026, taper: 0.76, claw: 0.033, spread: 0 },
    { name: 'III', yaw: 0,   n: 4, base: 0.024, taper: 0.78, claw: 0.026, spread: 0 },
    { name: 'IV',  yaw: 46,  n: 5, base: 0.019, taper: 0.80, claw: 0.022, spread: 0 },
  ];
  const foot = node('foot' + sfx, ankle, [M.tarsometatarsus - 0.001, -0.002, 0]);
  const toeRoots = [];
  for (const spec of toeSpec) {
    // toe splay is a rotation about the tarsometatarsus' own long axis (+X)
    const root = node('toe' + spec.name + sfx, foot,
      [0.002, -0.001, spec.yaw === 180 ? -0.002 : 0.0],
      [spec.yaw * D, 0, spec.name === 'I' ? 14 * D : 0]);
    let cur = root, segLen = spec.base, r = 0.0042;
    for (let i = 0; i < spec.n; i++) {
      const ph = boneTube(segLen, (t) => r * (1 - 0.18 * t) + 0.0006, null, { seg: 10 });
      cur.add(ph);
      cur.add(blob(r * 1.25, r * 1.15, r * 1.15, 0.0005, 0, 0));
      const nxt = node(`toe${spec.name}${sfx}_${i + 1}`, cur, [segLen, 0, 0]);
      rig.joints[nxt.name] = nxt;
      cur = nxt;
      segLen *= spec.taper; r *= 0.86;
    }
    // talon: strongly recurved keratin sheath
    const claw = boneTube(spec.claw, (t) => 0.0040 * Math.pow(1 - t, 0.85) + 0.0002,
      (t) => [-spec.claw * 0.62 * t * t, 0], { mat: CLAW_MAT, seg: 20, squashZ: 0.72 });
    cur.add(claw);
    toeRoots.push(root);
    rig.joints[`toe${spec.name}${sfx}`] = root;
    rig.toes.push(root);
  }

  rig.joints['hip' + sfx] = hip;
  rig.joints['knee' + sfx] = knee;
  rig.joints['ankle' + sfx] = ankle;
  rig.joints['foot' + sfx] = foot;
  return hip;
}

/* ------------------------------------------------------------------ */
/* full skeleton                                                       */
/* ------------------------------------------------------------------ */

export function buildEagleSkeleton() {
  const rig = { joints: {}, neck: [], tail: [], toes: [] };

  const root = new THREE.Object3D();      // world placement + body translation
  root.name = 'eagleRoot';
  const body = node('body', root);        // body pitch / roll / yaw / bob
  rig.root = root;
  rig.body = body;
  rig.joints.body = body;

  /* ---------------- pelvis + synsacrum ---------------- */
  const pelvis = node('pelvis', body, [0, 0, -0.035]);
  rig.joints.pelvis = pelvis;

  const syn = boneTube(0.115, (t) => 0.0088 - 0.0030 * Math.sin(t * Math.PI * 1.1),
    (t) => [0.006 * Math.sin(t * Math.PI), 0], { seg: 26 });
  // authored along +X -> rotate so the synsacrum runs cranially (+Z)
  syn.rotation.set(0, -Math.PI / 2, 0);
  syn.position.set(0, 0.020, -0.056);
  pelvis.add(syn);

  // ilium / ischium plates — broad fused pelvic roof
  for (const s of [-1, 1]) {
    pelvis.add(plate([
      [s * 0.006, 0.026, 0.058], [s * 0.020, 0.028, 0.020],
      [s * 0.026, 0.024, -0.020], [s * 0.022, 0.014, -0.052],
      [s * 0.012, 0.004, -0.062],
    ], 0.0055));
    pelvis.add(plate([
      [s * 0.010, 0.010, 0.040], [s * 0.024, 0.004, 0.006],
      [s * 0.026, -0.006, -0.026], [s * 0.016, -0.012, -0.050],
    ], 0.0040));
    // pubis — thin rod along the ventral margin
    pelvis.add(plate([
      [s * 0.018, -0.004, 0.010], [s * 0.020, -0.016, -0.024],
      [s * 0.014, -0.024, -0.058],
    ], 0.0026));
    // antitrochanter / acetabulum
    pelvis.add(blob(0.009, 0.009, 0.010, s * 0.023, 0.002, 0.012));
  }

  /* ---------------- tail: 5 free caudals + pygostyle ---------------- */
  let tp = node('tailBase', pelvis, [0, 0.014, -0.066], [0, 0, 0]);
  rig.joints.tailBase = tp;
  rig.tail.push(tp);
  for (let i = 0; i < 5; i++) {
    const v = vertebra(0.014, 0.0062 - i * 0.0004, 0.010 - i * 0.0012, 0.009 - i * 0.0011);
    v.rotation.y = Math.PI / 2;   // caudal direction is -Z
    tp.add(v);
    const nx = node('caudal' + i, tp, [0, 0, -0.014]);
    rig.joints['caudal' + i] = nx;
    rig.tail.push(nx);
    tp = nx;
  }
  // pygostyle — the fused ploughshare that anchors the 12 rectrices
  const pyg = boneTube(0.030, (t) => 0.0060 * (1 - 0.55 * t) + 0.001,
    (t) => [0.010 * t * t, 0], { squashZ: 0.42, seg: 18 });
  pyg.rotation.y = Math.PI / 2;
  tp.add(pyg);
  const pygNode = node('pygostyle', tp, [0, 0, -0.030]);
  rig.joints.pygostyle = pygNode;

  /* ---------------- thorax: notarium, ribs, sternum ---------------- */
  const thorax = node('thorax', pelvis, [0, 0.016, 0.052]);
  rig.joints.thorax = thorax;

  // notarium — fused thoracic vertebrae forming a rigid flight girder
  for (let i = 0; i < 5; i++) {
    const v = vertebra(0.017, 0.0080, 0.017, 0.013, { spineBlade: true });
    v.rotation.set(0, -Math.PI / 2, 0);
    v.position.set(0, 0.014 + i * 0.0016, -0.010 + i * 0.017);
    thorax.add(v);
  }

  // sternum with deep carina (keel) — 25-30% of the bird's whole bone mass
  const sternum = new THREE.Group();
  thorax.add(sternum);
  for (const s of [-1, 1]) {
    sternum.add(plate([
      [s * 0.004, -0.060, 0.042], [s * 0.030, -0.064, 0.020],
      [s * 0.034, -0.070, -0.020], [s * 0.028, -0.074, -0.056],
      [s * 0.012, -0.076, -0.080],
    ], 0.0055));
    // costal margin, articulating with the sternal ribs
    sternum.add(plate([
      [s * 0.026, -0.056, 0.030], [s * 0.034, -0.060, 0.000],
      [s * 0.036, -0.066, -0.032],
    ], 0.0032));
  }
  // keel blade
  const keelPts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const z = 0.046 - t * 0.128;
    const drop = MEASURE.keel * Math.sin(Math.min(1, t * 1.18) * Math.PI * 0.92);
    keelPts.push([0, -0.062 - drop, z]);
  }
  const keel = plate(keelPts, 0.0055);
  sternum.add(keel);
  // sternal spine
  sternum.add(blob(0.010, 0.010, 0.012, 0, -0.060, 0.046));

  // 7 pairs of ribs; 5 reach the sternum, with uncinate processes overlapping
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const zTop = 0.040 - i * 0.0165;
      const spread = 0.030 + 0.012 * Math.sin(t * Math.PI);
      const drop = 0.052 + 0.012 * Math.sin(t * Math.PI);
      const rib = plate([
        [s * 0.008, 0.014, zTop],
        [s * spread * 0.75, -0.004, zTop - 0.004],
        [s * spread, -0.028, zTop - 0.010],
        [s * spread * 0.86, -drop, zTop - 0.014],
      ], 0.0030);
      thorax.add(rib);
      if (i >= 1 && i <= 5) {
        // sternal (ventral) rib segment
        thorax.add(plate([
          [s * spread * 0.86, -drop, zTop - 0.014],
          [s * (spread * 0.62), -0.062, zTop - 0.028],
          [s * 0.030, -0.066, -0.006 - i * 0.008],
        ], 0.0026));
        // uncinate process — caudally directed strut bracing the next rib
        thorax.add(plate([
          [s * spread * 0.95, -0.020, zTop - 0.008],
          [s * spread * 0.92, -0.016, zTop - 0.022],
        ], 0.0024));
      }
    }
  }

  /* ---------------- wings ---------------- */
  const wingRootR = new THREE.Object3D(); wingRootR.name = 'wingRootR';
  const wingRootL = new THREE.Object3D(); wingRootL.name = 'wingRootL';
  wingRootL.scale.x = -1;                    // true bilateral mirror
  thorax.add(wingRootR, wingRootL);
  buildWing(wingRootR, rig, '.R');
  buildWing(wingRootL, rig, '.L');

  /* ---------------- legs ---------------- */
  const legRootR = new THREE.Object3D(); legRootR.name = 'legRootR';
  const legRootL = new THREE.Object3D(); legRootL.name = 'legRootL';
  legRootL.scale.x = -1;
  pelvis.add(legRootR, legRootL);
  buildLeg(legRootR, rig, '.R');
  buildLeg(legRootL, rig, '.L');

  /* ---------------- neck: 14 cervicals in the raptor S-curve ---------------- */
  // Rest curve: cervicals 1-4 dorsiflexed, 5-9 ventrally bowed, 10-14 raised,
  // which is what lets an eagle rotate its head past 180 degrees.
  const neckBase = node('neckBase', thorax, [0, 0.030, 0.068]);
  rig.joints.neckBase = neckBase;
  let cur = neckBase;
  const N = 14;
  // Cumulative shape of the resting avian S-curve: the cervical column rises
  // steeply off the shoulders (C1-C6), arches over, then carries the head
  // forward and slightly above horizontal. Negative = dorsiflexion (up).
  const restCurve = [-6, -14, -17, -16, -12, -5, 4, 9, 11, 10, 8, 6, 4, 2]; // deg pitch
  rig.neckRestCurve = restCurve;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const len = 0.0200 - 0.0062 * t;               // cervicals shorten cranially
    const rc = 0.0075 - 0.0026 * t;
    const v = vertebra(len, rc, i < 10 ? 0.006 + 0.004 * (1 - t) : 0.004, 0.010 - 0.004 * t);
    v.rotation.set(0, -Math.PI / 2, 0);            // run cranially (+Z)
    cur.add(v);
    // cervical rib (processus costalis) — fused, forms the vertebrarterial canal
    for (const s of [-1, 1]) {
      const cr = plate([
        [s * (0.008 - 0.003 * t), -0.001, 0.002],
        [s * (0.009 - 0.003 * t), -0.004, -0.006 - 0.004 * (1 - t)],
      ], 0.0016);
      cur.add(cr);
    }
    const nx = node('c' + i, cur, [0, 0, len]);
    nx.rotation.x = restCurve[i] * D;
    nx.userData.rest = nx.quaternion.clone();
    rig.joints['c' + i] = nx;
    rig.neck.push(nx);
    cur = nx;
  }

  /* ---------------- skull ---------------- */
  const skull = buildSkull(cur);
  skull.rotation.x = -4 * D;                 // atlanto-occipital rest tilt
  skull.userData.rest = skull.quaternion.clone();
  rig.joints.skull = skull;
  rig.joints.mandible = skull.userData.jaw;
  rig.skull = skull;

  // cache rest transforms for every joint
  for (const k in rig.joints) {
    const j = rig.joints[k];
    j.userData.rest = j.quaternion.clone();
    j.userData.restPos = j.position.clone();
  }

  // tag pure-bone meshes so the viewer can x-ray / hide them independently
  root.traverse((o) => {
    if (o.isMesh && (o.material === BONE_MAT || o.material === CARTILAGE_MAT)) {
      o.userData.isBone = true;
    }
    if (o.isMesh && o.material === KERATIN_MAT) o.userData.isBeak = true;
    if (o.isMesh && o.material === CLAW_MAT) o.userData.isClaw = true;
  });

  // resting hip height with the default standing pose
  rig.standHeight = 0.30;
  return rig;
}
