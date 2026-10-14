// Scene assembly: meshes, Lumen-Scene placements, surface-cache cards.
// Card generation follows Unreal's idea (mesh cards = oriented capture planes clustered
// from the mesh, captured into one atlas), implemented here as dominant-normal-axis
// clustering: every triangle joins the card whose axis its normal most aligns with,
// each card is the bounding rectangle of its cluster on that axis plane. Cards are
// captured once in mesh-local space; rigid motion never recaptures them.
import { VEHICLE_POSITIONS, VEHICLE_TRIANGLES, VEHICLE_FAMILIES, WHEEL_POSITIONS, WHEEL_TRIANGLES, WHEEL_FAMILIES } from './control-vehicle-data.js';
import { buildCourseMeshes, buildBoxMesh, Mat, coneOrigin } from './course.js';
import { matIdentity, matMultiply, matTranslation, matScale, matChassis, V3 } from './math.js';

// Frontier VehicleGeometry (ControlVehicle.blend sockets, metres):
export const VEHICLE = {
  Mass: 1300, Wheelbase: 3.396, Track: 2.095, CoMHeight: 0.53,
  TyreRadius: 0.50855, TyreRimRadius: 0.34460, TyreWidth: 0.39580,
  ModelGroundOffset: 0.50855 - 0.0914,           // 0.41715
  CoMModelZ: 0.53 - (0.50855 - 0.0914),          // 0.11285 — body vertices are rebased by this
  Axles: [ [1.7274, 1.0475], [1.7274, -1.0475], [-1.6686, 1.0475], [-1.6686, -1.0475] ], // FL FR RL RR (x,y), socket z 0.0914
  HubLocalZ: 0.0914 - (0.53 - (0.50855 - 0.0914)), // hub z relative to CoM = -0.02145
  MaxSteerRad: 0.52,
};

function soupFromIndexed(positions, triangles, families, rebaseZ = 0, scale = 1) {
  const out = new Float32Array(triangles.length * 3);
  const mats = new Uint32Array(triangles.length / 3);
  for (let t = 0; t < triangles.length / 3; t++) {
    mats[t] = families[t];
    for (let k = 0; k < 3; k++) {
      const vi = triangles[t * 3 + k];
      out[(t * 3 + k) * 3 + 0] = positions[vi * 3 + 0] * scale;
      out[(t * 3 + k) * 3 + 1] = positions[vi * 3 + 1] * scale;
      out[(t * 3 + k) * 3 + 2] = positions[vi * 3 + 2] * scale - rebaseZ;
    }
  }
  return { positions: out, materials: mats };
}
function soupFromRaw(raw) { // {positions: number[], materials: number[] per tri}
  return { positions: new Float32Array(raw.positions), materials: new Uint32Array(raw.materials) };
}

// Closed rest tyre envelope, re-implemented from Frontier WheelProjection.h
// BuildRestTyreEnvelope (rings x segments tread + bead circles, BeadWidthRatio 0.74 from RigidWheel.h).
// Segment count 64 here (native render tessellation is 128); radius/width/bead are the authored values.
function buildTyreMesh() {
  const Radius = VEHICLE.TyreRadius, RimRadius = VEHICLE.TyreRimRadius, Width = VEHICLE.TyreWidth;
  const Rings = 9, Segments = 64, BeadWidthRatio = 0.74, HalfWidth = Width / 2;
  const verts = [];
  for (let r = 0; r < Rings; r++) {
    const across = r / (Rings - 1), y = HalfWidth - 2 * HalfWidth * across;
    for (let s = 0; s < Segments; s++) { const a = 2 * Math.PI * s / Segments; verts.push([Radius * Math.cos(a), y, Radius * Math.sin(a)]); }
  }
  for (let side = 0; side < 2; side++) for (let s = 0; s < Segments; s++) {
    const a = 2 * Math.PI * s / Segments;
    verts.push([RimRadius * Math.cos(a), (side === 0 ? 1 : -1) * HalfWidth * BeadWidthRatio, RimRadius * Math.sin(a)]);
  }
  const positions = [], materials = [];
  const quad = (A,B,C,D) => { positions.push(...verts[A],...verts[C],...verts[B], ...verts[A],...verts[D],...verts[C]); materials.push(Mat.Tyre, Mat.Tyre); };
  for (let r = 0; r + 1 < Rings; r++) for (let s = 0; s < Segments; s++) {
    const n = (s + 1) % Segments;
    quad(r*Segments+s, (r+1)*Segments+s, (r+1)*Segments+n, r*Segments+n);
  }
  const Left = Rings * Segments, Right = Left + Segments, Shoulder = (Rings - 1) * Segments;
  for (let s = 0; s < Segments; s++) {
    const n = (s + 1) % Segments;
    quad(Left+s, s, n, Left+n);
    quad(Shoulder+s, Right+s, Right+n, Shoulder+n);
    quad(Left+s, Left+n, Right+n, Right+s);
  }
  return { positions: new Float32Array(positions), materials: new Uint32Array(materials) };
}

export function buildScene() {
  const meshes = [];   // {name, positions(soup), materials(per tri), dfLongest, cardTexel}
  const dfMeshes = []; // unique DF bakes: index -> mesh index whose geometry defines it
  const addMesh = (name, soup, dfLongest, cardTexel) => { meshes.push({ name, ...soup, dfLongest, cardTexel }); return meshes.length - 1; };

  const bodySoup = soupFromIndexed(VEHICLE_POSITIONS, VEHICLE_TRIANGLES, VEHICLE_FAMILIES, VEHICLE.CoMModelZ);
  const bodyMesh = addMesh('ControlVehicle body', bodySoup, 56, 0.075);

  const rimScale = VEHICLE.TyreRimRadius / 0.344818;
  const rimSoup = soupFromIndexed(WHEEL_POSITIONS, WHEEL_TRIANGLES, WHEEL_FAMILIES, 0, rimScale);
  const tyreSoup = buildTyreMesh();
  const wheelPositions = new Float32Array(tyreSoup.positions.length + rimSoup.positions.length);
  wheelPositions.set(tyreSoup.positions, 0); wheelPositions.set(rimSoup.positions, tyreSoup.positions.length);
  const wheelMats = new Uint32Array(tyreSoup.materials.length + rimSoup.materials.length);
  wheelMats.set(tyreSoup.materials, 0); wheelMats.set(rimSoup.materials, tyreSoup.materials.length);
  const wheelMesh = addMesh('Wheel (tyre envelope + authored rim)', { positions: wheelPositions, materials: wheelMats }, 36, 0.05);

  const course = buildCourseMeshes();
  const checkerMesh = addMesh('Drive course checker pad', soupFromRaw(course.checker), 64, 0.9);
  const rampMesh = addMesh('Drive course ramp', soupFromRaw(course.ramp), 32, 0.15);
  const bumpsMesh = addMesh('Drive course speed bumps', soupFromRaw(course.bumps), 32, 0.08);
  const coneMesh = addMesh('Slalom cone', soupFromRaw(course.cones), 16, 0.05);
  // One shared unit-box DF for every box-shaped placement (walls, kerb, pillars, cubes).
  const boxDfMesh = addMesh('Unit box (DF source)', soupFromRaw(buildBoxMesh(Mat.Surround)), 20, 0.1);
  const boxMeshByMat = {};
  const boxMesh = (mat) => { if (boxMeshByMat[mat] === undefined) boxMeshByMat[mat] = addMesh('Box mat ' + mat, soupFromRaw(buildBoxMesh(mat)), 20, 0.1); return boxMeshByMat[mat]; };

  const placements = [];
  const addPlacement = (name, mesh, opts = {}) => {
    placements.push({
      name, mesh, dfMesh: opts.dfMesh !== undefined ? opts.dfMesh : mesh,
      matrix: opts.matrix || matIdentity(), dynamic: !!opts.dynamic,
      materialOverride: opts.materialOverride !== undefined ? opts.materialOverride : 0xFFFFFFFF,
      emissiveMesh: !!opts.emissiveMesh, kind: opts.kind || 'static',
    });
    return placements.length - 1;
  };
  const boxAt = (name, mat, center, size, opts = {}) =>
    addPlacement(name, boxMesh(mat), { dfMesh: boxDfMesh, matrix: matMultiply(matTranslation(center), matScale(size)), ...opts });

  addPlacement('Checker pad (DriveCourse)', checkerMesh, {});
  boxAt('Surround apron', Mat.Surround, [0, 0, -0.06], [260, 260, 0.08]);
  addPlacement('Ramp (DriveCourse)', rampMesh, {});
  addPlacement('Speed bumps (DriveCourse)', bumpsMesh, {});
  boxAt('Kerb (DriveCourse)', Mat.Surround, [( -14 + 26) / 2, 3.20 + 0.15, 0.06], [40, 0.30, 0.12]);
  for (let k = 0; k < 8; k++) { const [x, y] = coneOrigin(k); addPlacement('Slalom cone ' + k, coneMesh, { matrix: matTranslation([x, y, 0]) }); }

  // GI architecture around the pad: coloured enclosure so colour bleeding and the
  // surface-cache bounce are visible while driving (geometry is ordinary placements —
  // it goes through the identical mesh-DF / card / radiosity path as the vehicle).
  boxAt('Red wall', Mat.WallRed, [-4, 11, 1.75], [20, 0.5, 3.5]);
  boxAt('Blue wall', Mat.WallBlue, [-4, -11, 1.75], [20, 0.5, 3.5]);
  boxAt('Teal end wall', Mat.WallTeal, [-14.25, 0, 1.75], [0.5, 22.5, 3.5]);
  boxAt('Pillar A', Mat.Pillar, [4, 6, 1.5], [0.6, 0.6, 3.0]);
  boxAt('Pillar B', Mat.Pillar, [4, -6, 1.5], [0.6, 0.6, 3.0]);
  boxAt('Pillar C', Mat.Pillar, [-10, 6, 1.5], [0.6, 0.6, 3.0]);
  boxAt('Pillar D', Mat.Pillar, [-10, -6, 1.5], [0.6, 0.6, 3.0]);
  boxAt('Overhead emissive panel', Mat.EmissivePanel, [-3, 0, 5.4], [12, 7, 0.25], { emissiveMesh: true });
  boxAt('Cyan emissive strip', Mat.EmissiveStripCyan, [-4, 10.72, 2.6], [14, 0.08, 0.5], { emissiveMesh: true });
  boxAt('Warm emissive strip', Mat.EmissiveStripWarm, [-4, -10.72, 2.6], [14, 0.08, 0.5], { emissiveMesh: true });
  // Small emissive meshes — below the Lumen Scene size threshold, so Unreal culls them
  // from the Lumen Scene (no mesh DF, no cards feeding GI); they still appear in screen
  // traces. That documented inconsistency is reproduced deliberately (toggle in UI).
  const smallEmissives = [];
  const smallPos = [[2, 9.8, 0.09], [2, -9.8, 0.09], [-8, 9.8, 0.09], [-8, -9.8, 0.09], [-13.6, 3, 0.09], [-13.6, -3, 0.09]];
  smallPos.forEach((p, i) => { smallEmissives.push(addPlacement('Small emissive cube ' + i, boxMesh(Mat.SmallEmissive), { dfMesh: boxDfMesh, matrix: matMultiply(matTranslation(p), matScale([0.18, 0.18, 0.18])), emissiveMesh: true, kind: 'smallEmissive' })); });

  const bodyPlacement = addPlacement('ControlVehicle', bodyMesh, { dynamic: true, kind: 'vehicleBody' });
  const wheelPlacements = [0,1,2,3].map(i => addPlacement('Wheel ' + ['FL','FR','RL','RR'][i],
    wheelMesh, { dynamic: true, kind: 'wheel' }));

  return { meshes, placements, bodyPlacement, wheelPlacements, smallEmissives };
}

// ---------------- surface-cache cards ----------------
const AXIS_CARDS = [
  { n: [1,0,0],  t: [0,1,0],  b: [0,0,1] }, { n: [-1,0,0], t: [0,-1,0], b: [0,0,1] },
  { n: [0,1,0],  t: [0,0,1],  b: [1,0,0] }, { n: [0,-1,0], t: [0,0,1],  b: [-1,0,0] },
  { n: [0,0,1],  t: [1,0,0],  b: [0,1,0] }, { n: [0,0,-1], t: [-1,0,0], b: [0,1,0] },
];
export function generateCardTemplates(mesh) {
  const pos = mesh.positions, triCount = pos.length / 9;
  const buckets = AXIS_CARDS.map(() => []);
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const l = Math.hypot(nx,ny,nz); if (l < 1e-20) continue; nx/=l; ny/=l; nz/=l;
    const comps = [nx, ny, nz]; let axis = 0, best = -1;
    for (let a = 0; a < 3; a++) if (Math.abs(comps[a]) > best) { best = Math.abs(comps[a]); axis = a; }
    buckets[axis * 2 + (comps[axis] < 0 ? 1 : 0)].push(t);
  }
  const templates = [];
  buckets.forEach((tris, bi) => {
    if (!tris.length) return;
    const def = AXIS_CARDS[bi];
    let tmin=1e30, bmin=1e30, tmax=-1e30, bmax=-1e30, dmax=-1e30;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const p = [pos[(t*3+k)*3], pos[(t*3+k)*3+1], pos[(t*3+k)*3+2]];
      const tu = V3.dot(p, def.t), bv = V3.dot(p, def.b), d = V3.dot(p, def.n);
      tmin=Math.min(tmin,tu); bmin=Math.min(bmin,bv); tmax=Math.max(tmax,tu); bmax=Math.max(bmax,bv); dmax=Math.max(dmax,d);
    }
    const sizeT = Math.max(tmax - tmin, 1e-4), sizeB = Math.max(bmax - bmin, 1e-4);
    const maxDim = mesh.name.includes('checker') ? 160 : 96;
    const resT = Math.max(2, Math.min(maxDim, Math.round(sizeT / mesh.cardTexel)));
    const resB = Math.max(2, Math.min(maxDim, Math.round(sizeB / mesh.cardTexel)));
    const origin = V3.add(V3.add(V3.scale(def.t, (tmin+tmax)/2), V3.scale(def.b, (bmin+bmax)/2)), V3.scale(def.n, dmax));
    templates.push({ normal: def.n, tangent: def.t, bitangent: def.b, origin, uvMin: [tmin, bmin], uvSize: [sizeT, sizeB], res: [resT, resB], bucketTris: tris.length });
  });
  return templates;
}

// Pack every placement's cards into the atlas (shelf packing), build texel lists.
export function buildCards(scene, atlasW = 1024, atlasH = 512) {
  const templatesByMesh = scene.meshes.map(m => generateCardTemplates(m));
  const cards = [];
  scene.placements.forEach((pl, pi) => {
    pl.firstCard = cards.length;
    for (const tpl of templatesByMesh[pl.mesh]) cards.push({ placement: pi, mesh: pl.mesh, ...tpl, atlas: [0, 0] });
    pl.cardCount = cards.length - pl.firstCard;
  });
  // shelf pack, tallest first
  const order = cards.map((c, i) => i).sort((a, b) => cards[b].res[1] - cards[a].res[1]);
  let x = 0, y = 0, shelfH = 0, ok = true;
  for (const ci of order) {
    const c = cards[ci];
    if (x + c.res[0] > atlasW) { x = 0; y += shelfH; shelfH = 0; }
    if (y + c.res[1] > atlasH) { ok = false; break; }
    c.atlas = [x, y]; x += c.res[0]; shelfH = Math.max(shelfH, c.res[1]);
  }
  if (!ok) throw new Error('Surface-cache atlas overflow — increase atlas size');
  const atlasMap = new Int32Array(atlasW * atlasH).fill(-1);
  const dynamicTexels = [], staticTexels = [];
  cards.forEach((c, ci) => {
    const list = scene.placements[c.placement].dynamic ? dynamicTexels : staticTexels;
    for (let yy = 0; yy < c.res[1]; yy++) for (let xx = 0; xx < c.res[0]; xx++) {
      const idx = (c.atlas[1] + yy) * atlasW + c.atlas[0] + xx;
      atlasMap[idx] = ci; list.push(idx);
    }
  });
  return { cards, templatesByMesh, atlasMap, dynamicTexels: new Uint32Array(dynamicTexels), staticTexels: new Uint32Array(staticTexels), atlasW, atlasH };
}

export function meshBounds(mesh) {
  const p = mesh.positions, mn=[1e30,1e30,1e30], mx=[-1e30,-1e30,-1e30];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { mn[a]=Math.min(mn[a],p[i+a]); mx[a]=Math.max(mx[a],p[i+a]); }
  return { mn, mx };
}
