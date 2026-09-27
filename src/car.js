// ============================================================================
// car.js — low-poly street sedan test mule, modeled after a classic boxy
// Nissan Sentra: sharp slab sides, wedge nose, greenhouse band, V-grille hint,
// lip spoiler and the #99 roundel (a nod to Alita's motorball number).
// Built entirely from primitives + one side-profile extrusion. ~3.5k tris.
// Forward axis = +Z. Scale in meters: 4.56 L × 1.80 W.
// ============================================================================
import * as THREE from 'three';

export const PAINTS = [
  { name: 'SENTRA CRIMSON', color: 0xa31621 },
  { name: 'ASPEN WHITE', color: 0xdfe3e6 },
  { name: 'SUPER BLACK', color: 0x141518 },
  { name: 'BLUE ONYX', color: 0x1a3d6e },
  { name: 'GUN METALLIC', color: 0x565d66 },
];

function roundelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 60, 0, 7);
  g.fillStyle = '#e8e8ea'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#101114'; g.stroke();
  g.fillStyle = '#101114';
  g.font = '900 58px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('99', 64, 67);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCar(scene) {
  const car = { paintIndex: 0 };
  const grp = new THREE.Group();
  car.group = grp;

  const paint = new THREE.MeshStandardMaterial({
    color: PAINTS[0].color, roughness: 0.38, metalness: 0.45, flatShading: true,
  });
  car.paint = paint;
  const trim = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.7, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.25, metalness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0c1620, roughness: 0.12, metalness: 0.9, side: THREE.DoubleSide,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x101215, roughness: 0.92 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x939aa4, roughness: 0.3, metalness: 0.85, flatShading: true });

  // ---------------- body shell: extruded side profile (z forward, y up)
  const profile = new THREE.Shape();
  profile.moveTo(2.30, 0.16);   // front bumper bottom
  profile.lineTo(2.36, 0.42);   // bumper face
  profile.lineTo(2.30, 0.56);   // nose
  profile.lineTo(2.02, 0.80);   // hood leading edge
  profile.lineTo(0.62, 0.92);   // hood / cowl
  profile.lineTo(-0.28, 1.38);  // windshield → roof front
  profile.lineTo(-1.30, 1.42);  // roof rear
  profile.lineTo(-1.85, 1.06);  // rear window → trunk
  profile.lineTo(-2.30, 1.00);  // tail top
  profile.lineTo(-2.34, 0.20);  // tail bottom
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 1.74, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -0.87);
  bodyGeo.rotateY(-Math.PI / 2); // shape (x=forward-axis) → z forward
  const body = new THREE.Mesh(bodyGeo, paint);
  grp.add(body);

  // ---------------- greenhouse glass band (side windows, mirror-symmetric)
  const ghShape = new THREE.Shape();
  ghShape.moveTo(0.60, 0.96);   // cowl
  ghShape.lineTo(-0.05, 1.33);  // A-pillar slope
  ghShape.lineTo(-1.42, 1.33);  // roofline
  ghShape.lineTo(-2.07, 0.96);  // C-pillar slope (mirrored)
  ghShape.closePath();
  const ghGeo = new THREE.ShapeGeometry(ghShape);
  // rotateY(-PI/2): shape-x → +z (forward), normal → -x → left side
  // rotateY(+PI/2) mirrors the symmetric band for the right side
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(ghGeo, glass);
    win.rotation.y = s * Math.PI / 2;
    win.position.set(s * 0.895, 0, 0);
    grp.add(win);
  }
  // windshield + rear window panes
  const paneW = 1.62;
  const mkPane = (z0, y0, z1, y1) => {
    const len = Math.hypot(z1 - z0, y1 - y0) * 0.99;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(paneW, len), glass);
    p.rotation.x = Math.atan2(z1 - z0, y1 - y0);
    p.position.set(0, (y0 + y1) / 2 + 0.014, (z0 + z1) / 2);
    return p;
  };
  const ws = mkPane(0.60, 0.94, -0.26, 1.40);   // windshield
  const rw = mkPane(-1.32, 1.41, -1.86, 1.07);  // rear window
  grp.add(ws); grp.add(rw);

  // ---------------- face: grille + headlights (Sentra V-motion hint)
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.20, 0.08), trim);
  grille.position.set(0, 0.60, 2.335);
  grp.add(grille);
  for (const s of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.09), chrome);
    v.position.set(s * 0.26, 0.615, 2.345);
    v.rotation.z = s * 0.42;
    grp.add(v);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xdfeaf2, toneMapped: false }));
    hl.position.set(s * 0.62, 0.68, 2.31);
    hl.rotation.y = s * 0.12;
    grp.add(hl);
    // amber corner marker
    const mk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xd88f2a, toneMapped: false }));
    mk.position.set(s * 0.86, 0.66, 2.27);
    grp.add(mk);
  }
  // bumper + intake
  const fBump = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.22, 0.14), trim);
  fBump.position.set(0, 0.28, 2.33);
  grp.add(fBump);
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.1), trim);
  intake.position.set(0, 0.42, 2.34);
  grp.add(intake);

  // ---------------- tail
  const rBump = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.22, 0.12), trim);
  rBump.position.set(0, 0.30, -2.36);
  grp.add(rBump);
  const tailBand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.06), trim);
  tailBand.position.set(0, 0.86, -2.35);
  grp.add(tailBand);
  car.brakeMats = [];
  for (const s of [-1, 1]) {
    const bm = new THREE.MeshBasicMaterial({ color: 0x6b1010, toneMapped: false });
    car.brakeMats.push(bm);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.05), bm);
    tl.position.set(s * 0.52, 0.86, -2.385);
    grp.add(tl);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xc9d4dc, roughness: 0.5 }));
  plate.position.set(0, 0.62, -2.37);
  grp.add(plate);

  // lip spoiler
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.05, 0.3), trim);
  spoiler.position.set(0, 1.045, -2.18);
  spoiler.rotation.x = -0.08;
  grp.add(spoiler);

  // ---------------- aero+details
  for (const s of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 2.4), trim);
    skirt.position.set(s * 0.9, 0.18, 0);
    grp.add(skirt);
    const mirrorStalk = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.16), trim);
    mirrorStalk.position.set(s * 0.97, 1.02, 0.48);
    grp.add(mirrorStalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.2), paint);
    mirror.position.set(s * 1.0, 1.06, 0.48);
    grp.add(mirror);
    // #99 door roundels
    const roundel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.66, 0.66),
      new THREE.MeshBasicMaterial({ map: roundelTexture(), transparent: true })
    );
    roundel.position.set(s * 0.913, 0.62, -0.35);
    roundel.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    grp.add(roundel);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.4, 5), trim);
  antenna.position.set(0.3, 1.56, -1.15);
  grp.add(antenna);
  // exhaust tips
  car.exhaustTips = [];
  for (const s of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.16, 8), chrome);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(s * 0.45, 0.24, -2.38);
    grp.add(ex);
    car.exhaustTips.push(ex);
  }

  // nitro flames (visible while boosting)
  const flameTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,220,1)');
    grd.addColorStop(0.35, 'rgba(120,210,255,0.9)');
    grd.addColorStop(1, 'rgba(40,110,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  car.flames = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTex, color: 0x9fd8ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.position.set(s * 0.45, 0.24, -2.52);
    sp.scale.setScalar(0.001);
    grp.add(sp);
    car.flames.push(sp);
  }

  // ---------------- wheels (groups so we can spin/steer them)
  const wheelGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.235, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.245, 10);
  hubGeo.rotateZ(Math.PI / 2);
  car.wheels = [];
  car.frontAxle = [];
  for (const [sx, sz, front] of [[-1, 1.42, true], [1, 1.42, true], [-1, -1.42, false], [1, -1.42, false]]) {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    const hubL = new THREE.Mesh(hubGeo, hubMat);
    wg.add(tire); wg.add(hubL);
    // lug nuts on the outer face — simple 5-bolt hint
    for (let k = 0; k < 5; k++) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), trim);
      const a = (k / 5) * Math.PI * 2;
      lug.position.set(sx * 0.128, Math.cos(a) * 0.085, Math.sin(a) * 0.085);
      wg.add(lug);
    }
    wg.position.set(sx * 0.80, 0.335, sz);
    grp.add(wg);
    car.wheels.push(wg);
    if (front) car.frontAxle.push(wg);
  }

  // blob shadow (cheap, pitch-black disc)
  const shTexC = document.createElement('canvas');
  shTexC.width = shTexC.height = 64;
  const sg = shTexC.getContext('2d');
  const sgrd = sg.createRadialGradient(32, 32, 6, 32, 32, 30);
  sgrd.addColorStop(0, 'rgba(0,0,0,0.55)');
  sgrd.addColorStop(0.8, 'rgba(0,0,0,0.28)');
  sgrd.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = sgrd;
  sg.beginPath(); sg.ellipse(32, 32, 29, 20, 0, 0, 7); sg.fill();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shTexC), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  car.shadow = shadow;
  scene.add(shadow);

  scene.add(grp);
  return car;
}
