// Proper city parking: surface lots (painted bays, aisles, arrows,
// accessible bays, landscaped islands, lights, kiosks) and multi-storey
// parking decks with ramps, columns and parapets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterials } from './materials.js';
import { getTextures } from './textures.js';

function mergeToMesh(geos, mat, name) {
  const usable = geos.filter(Boolean);
  if (!usable.length) return null;
  const merged = mergeGeometries(usable, false);
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  usable.forEach((g) => g.dispose());
  return mesh;
}

function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function quad(w, h, x, y, z, ry = 0, rx = -Math.PI / 2) {
  const g = new THREE.PlaneGeometry(w, h);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** Painted parking-bay strip. */
function bayLine(x0, z0, x1, z1, y, width = 0.12) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const g = new THREE.BoxGeometry(width, 0.022, len);
  g.rotateY(Math.atan2(dx, dz));
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

function treeAt(x, y, z, scale, pieces) {
  pieces.bark.push(box(0.14 * scale, 2.4 * scale, 0.14 * scale, x, y + 1.2 * scale, z));
  const canopy = new THREE.SphereGeometry(1.15 * scale, 8, 8);
  canopy.translate(x, y + 3.1 * scale, z);
  pieces.leaf.push(canopy);
  const c2 = new THREE.SphereGeometry(0.85 * scale, 8, 8);
  c2.translate(x + 0.5 * scale, y + 3.75 * scale, z + 0.25 * scale);
  pieces.leafLight.push(c2);
}

function lightMast(x, y, z, ry, pieces) {
  pieces.metalDark.push(box(0.34, 0.18, 0.34, x, y + 0.09, z));
  pieces.metalDark.push(box(0.11, 7.4, 0.11, x, y + 3.7, z, ry));
  const armX = x + Math.sin(ry) * 1.5;
  const armZ = z + Math.cos(ry) * 1.5;
  pieces.metalDark.push(box(0.1, 0.1, 3.0, (x + armX) / 2, y + 7.3, (z + armZ) / 2, ry));
  pieces.lampGlass.push(box(0.42, 0.12, 1.0, armX, y + 7.18, armZ, ry));
}

function kiosk(x, y, z, ry, pieces) {
  pieces.concrete.push(box(2.6, 0.18, 1.6, x, y + 0.09, z, ry));
  pieces.metalDark.push(box(0.72, 1.15, 0.5, x, y + 0.75, z, ry));
  pieces.lampGlass.push(box(0.6, 0.34, 0.04, x + Math.sin(ry) * 0.28, y + 1.05, z + Math.cos(ry) * 0.28, ry));
  // P blade sign
  pieces.metalDark.push(box(0.1, 3.2, 0.1, x + Math.sin(ry) * 1.2, y + 1.6, z + Math.cos(ry) * 1.2));
  pieces.paintYellow.push(box(0.9, 0.9, 0.06, x + Math.sin(ry) * 1.2, y + 3.1, z + Math.cos(ry) * 1.2, ry));
  pieces.paintWhite.push(box(0.55, 0.55, 0.08, x + Math.sin(ry) * 1.2, y + 3.1, z + Math.cos(ry) * 1.2, ry));
}

function newPieces() {
  return {
    asphalt: [],
    concrete: [],
    paintWhite: [],
    paintYellow: [],
    paintBlue: [],
    metalDark: [],
    lampGlass: [],
    grass: [],
    bark: [],
    leaf: [],
    leafLight: [],
    rubber: [],
  };
}

/**
 * Surface parking lot.
 * lot: {x, z, w, h, rotY, angle(90|60), name}
 */
export function buildParkingLot(lot) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = lot.name || 'Parking lot';
  group.userData = { objectId: lot.id, kind: 'parking' };

  const w = lot.w ?? 72;
  const h = lot.h ?? 46;
  const rotY = lot.rotY ?? 0;
  const bayAngle = ((lot.angle ?? 90) * Math.PI) / 180;
  const pieces = newPieces();

  const root = new THREE.Group();
  root.position.set(lot.x, 0, lot.z);
  root.rotation.y = rotY;

  // ---- pad ----
  pieces.asphalt.push(box(w, 0.1, h, 0, 0.03, 0));

  // ---- perimeter curb ----
  const curbH = 0.16;
  pieces.concrete.push(
    box(w + 0.4, curbH, 0.3, 0, curbH / 2 + 0.06, h / 2 + 0.15),
    box(w + 0.4, curbH, 0.3, 0, curbH / 2 + 0.06, -h / 2 - 0.15),
    box(0.3, curbH, h, w / 2 + 0.15, curbH / 2 + 0.06, 0),
    box(0.3, curbH, h, -w / 2 - 0.15, curbH / 2 + 0.06, 0)
  );

  // ---- bay rows: two double rows + central aisle + side aisles ----
  const bayW = 2.55;
  const bayD = 5.05;
  const aisle = 6.4;
  const rowDepth = bayD * 2;
  const totalRowSpan = rowDepth * 2 + aisle * 3; // rows + aisles
  let zCursor = -totalRowSpan / 2 + aisle;
  const paint = pieces.paintWhite;
  const blue = pieces.paintBlue;

  const rows = [];
  for (let r = 0; r < 4; r++) {
    const z0 = zCursor + bayD; // row centre
    rows.push(z0);
    zCursor += r % 2 === 0 ? rowDepth + aisle : aisle - aisle + aisle;
    if (r % 2 === 1) zCursor += 0;
  }
  // simpler deterministic layout
  const rowCentres = [
    -totalRowSpan / 2 + aisle + bayD,
    -totalRowSpan / 2 + aisle + rowDepth + aisle + bayD,
    totalRowSpan / 2 - aisle - rowDepth - bayD,
    totalRowSpan / 2 - aisle - bayD,
  ];

  const ang = bayAngle;
  const depthAlongZ = ang === Math.PI / 2 ? bayD : bayD * Math.sin(ang);
  const bayPitch = ang === Math.PI / 2 ? bayW : bayW / Math.sin(ang);

  for (const [ri, zc] of rowCentres.entries()) {
    const flip = ri % 2 === 1; // facing the aisle
    const facing = flip ? -1 : 1;
    const nBays = Math.floor((w - 8) / bayPitch);
    for (let i = 0; i <= nBays; i++) {
      const x = (i - nBays / 2) * bayPitch;
      // bay separator lines (both sides of a back-to-back pair)
      for (const dz of [-bayD / 2, bayD / 2]) {
        const lean = Math.cos(ang) * dz * facing;
        paint.push(bayLine(x - Math.sin(ang) * (bayD / 2) * facing + lean * 0, zc + dz,
          x + Math.sin(ang) * (bayD / 2) * facing + lean * 0, zc - dz, 0.1));
      }
    }
    // row end line
    const half = (nBays / 2) * bayPitch + 0.2;
    paint.push(bayLine(-half, zc - bayD / 2, half, zc - bayD / 2, 0.1, 0.16));
    paint.push(bayLine(-half, zc + bayD / 2, half, zc + bayD / 2, 0.1, 0.16));
  }

  // ---- accessible bays (blue) near the entry ----
  const accX = -w / 2 + 7.5;
  for (let i = 0; i < 3; i++) {
    const x = accX + i * (bayW + 0.2);
    blue.push(box(bayW, 0.024, bayD, x, 0.112, rowCentres[0]));
    paint.push(bayLine(x - bayW / 2, rowCentres[0] - bayD / 2, x - bayW / 2, rowCentres[0] + bayD / 2, 0.12));
  }
  paint.push(box(bayW * 3 + 0.8, 0.024, bayD * 0.45, accX + bayW + 0.1, 0.112, rowCentres[0] + bayD * 0.72));

  // ---- aisle arrows ----
  const T = getTextures();
  const arrows = [];
  for (const zc of [-totalRowSpan / 2 + aisle / 2, 0, totalRowSpan / 2 - aisle / 2]) {
    for (let x = -w / 2 + 10; x < w / 2 - 8; x += 13) {
      const g = quad(2.2, 2.2, x, 0.115, zc, 0);
      arrows.push(g);
      void T;
    }
  }

  // ---- landscaped islands ----
  for (const zc of rowCentres) {
    for (const x of [-w / 2 + 4, 0, w / 2 - 4]) {
      pieces.concrete.push(box(3.4, curbH, bayD + 1.4, x, curbH / 2 + 0.06, zc));
      pieces.grass.push(box(3.0, 0.2, bayD + 1.0, x, 0.13, zc));
      treeAt(x, 0.18, zc, 1.05, pieces);
    }
  }

  // ---- lights + kiosks ----
  lightMast(-w / 2 + 5, 0.1, -h / 2 + 5, 0, pieces);
  lightMast(w / 2 - 5, 0.1, -h / 2 + 5, 0, pieces);
  lightMast(-w / 2 + 5, 0.1, h / 2 - 5, Math.PI, pieces);
  lightMast(w / 2 - 5, 0.1, h / 2 - 5, Math.PI, pieces);
  if (w > 55) {
    lightMast(0, 0.1, -h / 2 + 5, 0, pieces);
    lightMast(0, 0.1, h / 2 - 5, Math.PI, pieces);
  }
  kiosk(-w / 2 + 8, 0.1, h / 2 - 3.2, Math.PI, pieces);
  kiosk(w / 2 - 8, 0.1, h / 2 - 3.2, Math.PI, pieces);

  const map = {
    asphalt: M.asphalt,
    concrete: M.concrete,
    paintWhite: M.paintWhite,
    paintYellow: M.paintYellow,
    paintBlue: new THREE.MeshStandardMaterial({ color: 0x2b4fa0, roughness: 0.7 }),
    metalDark: M.metalDark,
    lampGlass: M.lampGlass,
    grass: M.grass,
    bark: M.bark,
    leaf: M.leaf,
    leafLight: M.leafLight,
    rubber: M.rubber,
  };
  for (const [key, geos] of Object.entries(pieces)) {
    const mesh = mergeToMesh(geos, map[key] || M.concrete, `lot:${key}`);
    if (mesh) root.add(mesh);
  }
  const arrowMesh = mergeToMesh(arrows, M.symbolArrow, 'lot:arrows');
  if (arrowMesh) root.add(arrowMesh);

  group.add(root);
  return group;
}

/**
 * Multi-storey parking deck.
 * lot: {x, z, w, h, rotY, levels, name}
 */
export function buildParkingDeck(lot) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = lot.name || 'Parking deck';
  group.userData = { objectId: lot.id, kind: 'parking' };

  const w = lot.w ?? 58;
  const h = lot.h ?? 40;
  const levels = lot.levels ?? 3;
  const rotY = lot.rotY ?? 0;
  const levelH = 3.4;

  const root = new THREE.Group();
  root.position.set(lot.x, 0, lot.z);
  root.rotation.y = rotY;

  const concrete = [];
  const concreteDark = [];
  const pillar = [];
  const paint = [];
  const metal = [];
  const lamp = [];

  // ground apron
  concreteDark.push(box(w + 10, 0.12, h + 10, 0, 0.05, 0));

  for (let lv = 0; lv <= levels; lv++) {
    const y = lv * levelH;
    // deck slab
    concrete.push(box(w, 0.38, h, 0, y + 0.19, 0));
    // slab edge beams
    concreteDark.push(box(w + 0.5, 0.7, 0.5, 0, y + 0.05, h / 2));
    concreteDark.push(box(w + 0.5, 0.7, 0.5, 0, y + 0.05, -h / 2));
    concreteDark.push(box(0.5, 0.7, h, w / 2, y + 0.05, 0));
    concreteDark.push(box(0.5, 0.7, h, -w / 2, y + 0.05, 0));
    if (lv < levels) {
      // parapet on open levels
      for (const [ox, oz, pw, pd] of [
        [0, h / 2, w, 0.22],
        [0, -h / 2, w, 0.22],
        [w / 2, 0, 0.22, h],
        [-w / 2, 0, 0.22, h],
      ]) {
        concrete.push(box(pw, 1.0, pd, ox, y + 0.9, oz));
      }
      // columns
      for (let cx = -w / 2 + 4; cx <= w / 2 - 4; cx += 12) {
        for (let cz = -h / 2 + 4; cz <= h / 2 - 4; cz += 12) {
          pillar.push(box(0.85, levelH, 0.85, cx, y + levelH / 2 + 0.38, cz));
        }
      }
      // bay lines on each deck level
      for (const zc of [-h / 2 + 7.5, -h / 2 + 17, h / 2 - 17, h / 2 - 7.5]) {
        for (let i = -Math.floor((w - 10) / 2.55) / 2; i < Math.floor((w - 10) / 2.55) / 2; i++) {
          paint.push(box(0.1, 0.022, 5, i * 2.55, y + 0.4, zc));
        }
      }
      // ceiling lights
      for (let cx = -w / 2 + 8; cx < w / 2 - 4; cx += 11) {
        lamp.push(box(2.2, 0.08, 0.4, cx, y + levelH - 0.35, 0));
      }
    }
  }

  // ramp: straight slope at the east end, zigzag between levels
  for (let lv = 0; lv < levels; lv++) {
    const y0 = lv * levelH + 0.38;
    const y1 = (lv + 1) * levelH + 0.38;
    const dir = lv % 2 === 0 ? 1 : -1;
    const ramp = new THREE.BoxGeometry(7, 0.32, h * 0.82);
    ramp.rotateX(Math.atan2(y1 - y0, h * 0.82) * (dir > 0 ? 1 : -1));
    ramp.translate(w / 2 - 5.5, (y0 + y1) / 2, dir * h * 0.04);
    concrete.push(ramp);
    // ramp guard
    metal.push(box(0.12, 0.9, h * 0.82, w / 2 - 2.2, (y0 + y1) / 2 + 0.55, dir * h * 0.04));
    metal.push(box(0.12, 0.9, h * 0.82, w / 2 - 8.8, (y0 + y1) / 2 + 0.55, dir * h * 0.04));
  }

  // entry kiosks + light masts
  kiosk(-w / 2 + 6, 0.12, h / 2 + 4, 0, {
    concrete, metalDark: metal, lampGlass: lamp, paintYellow: paint, paintWhite: paint, bark: [], leaf: [], leafLight: [], grass: [], asphalt: [], paintBlue: [], rubber: [],
  });
  lightMast(-w / 2 - 4, 0.1, h / 2 + 3, Math.PI, {
    metalDark: metal, lampGlass: lamp, bark: [], leaf: [], leafLight: [], grass: [], asphalt: [], paintWhite: [], paintYellow: [], paintBlue: [], concrete: [], rubber: [],
  });
  lightMast(w / 2 + 4, 0.1, -h / 2 - 3, 0, {
    metalDark: metal, lampGlass: lamp, bark: [], leaf: [], leafLight: [], grass: [], asphalt: [], paintWhite: [], paintYellow: [], paintBlue: [], concrete: [], rubber: [],
  });

  const merged = [
    [concrete, M.concrete, 'deck:concrete'],
    [concreteDark, M.concreteDark, 'deck:edge'],
    [pillar, M.pillar, 'deck:columns'],
    [paint, M.paintWhite, 'deck:paint'],
    [metal, M.metalDark, 'deck:metal'],
    [lamp, M.lampGlass, 'deck:lights'],
  ];
  for (const [geos, mat, name] of merged) {
    const mesh = mergeToMesh(geos, mat, name);
    if (mesh) root.add(mesh);
  }

  group.add(root);
  return group;
}
