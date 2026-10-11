// Railway (tracks, ballast, level crossings) and subway (tunnels, stations).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterials } from './materials.js';
import { samplePolyline, sampleAt, ribbonGeometry, wallGeometry, polylineSampleLength } from './roadbuilder.js';

function mergeToMesh(geos, mat, name = 'rail') {
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

/**
 * Rail line: ballast bed, sleepers, two rails along the polyline.
 * crossings: [{s}] arc-length positions of level crossings (road panels).
 */
export function buildRail(rail) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = rail.name || 'Rail line';
  group.userData = { objectId: rail.id, kind: 'rail' };

  const samples = samplePolyline(rail.points, 3);
  const total = polylineSampleLength(samples);
  const halfBed = 2.9;

  // ballast trapezoid approximated with two ribbons + side walls
  const bed = [
    ribbonGeometry(samples, -halfBed, halfBed, 0.16, { vScale: 0.2 }),
    wallGeometry(samples, -halfBed, 0, 0.16),
    wallGeometry(samples, halfBed, 0, 0.16),
  ];
  const bedMesh = mergeToMesh(bed, M.ballast, `${rail.id}:ballast`);
  if (bedMesh) group.add(bedMesh);

  // sleepers (skip the crossing panel zones so road & track meet cleanly)
  const crossings = rail.crossings || [];
  const nearCrossing = (s) => crossings.some((c) => Math.abs(c.s - s) < 7.5);
  const sleepers = [];
  for (let s = 0; s < total - 0.4; s += 0.72) {
    if (nearCrossing(s)) continue;
    const sm = sampleAt(samples, s);
    const sl = new THREE.BoxGeometry(2.6, 0.15, 0.26);
    sl.rotateY(Math.atan2(sm.tx, sm.tz));
    sl.translate(sm.x, sm.y + 0.26, sm.z);
    sleepers.push(sl);
  }
  const slMesh = mergeToMesh(sleepers, M.sleeper, `${rail.id}:sleepers`);
  if (slMesh) group.add(slMesh);

  // rails
  const rails = [];
  for (const off of [-0.7175, 0.7175]) {
    rails.push(ribbonGeometry(samples, off - 0.04, off + 0.04, 0.42, { vScale: 0.6 }));
    rails.push(wallGeometry(samples, off - 0.04, 0.32, 0.42));
    rails.push(wallGeometry(samples, off + 0.04, 0.32, 0.42));
  }
  const railMesh = mergeToMesh(rails, M.railSteel, `${rail.id}:rails`);
  if (railMesh) group.add(railMesh);

  // level crossings
  for (const crossing of rail.crossings || []) {
    const g = buildLevelCrossing(samples, crossing);
    group.add(g);
  }
  return group;
}

/** Rotate a geometry so its local +X axis points along (dirX, dirZ). */
function orientAlong(geo, dirX, dirZ) {
  geo.rotateY(Math.atan2(-dirZ, dirX));
  return geo;
}

function localBox(w, h, d, roadX, roadZ, x, y, z, ox, oy, oz) {
  // box of size w(road) x h x d(rail corridor), offset (ox,oy,oz) in road frame
  const g = new THREE.BoxGeometry(w, h, d);
  orientAlong(g, roadX, roadZ);
  const px = x + roadX * ox - roadZ * oz;
  const pz = z + roadZ * ox + roadX * oz;
  g.translate(px, y + oy, pz);
  return g;
}

/**
 * Proper level crossing: flangeway panels between/around the rails, concrete
 * approach slabs with rumble strips, stop lines, advance warning boards,
 * wig-wag signals, crossbucks, bells and counterweighted gate booms.
 */
function buildLevelCrossing(samples, crossing) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = 'level-crossing';
  const sm = sampleAt(samples, crossing.s);
  let roadX = crossing.roadDirX ?? 1;
  let roadZ = crossing.roadDirZ ?? 0;
  const rLen = Math.hypot(roadX, roadZ) || 1;
  roadX /= rLen;
  roadZ /= rLen;
  const railX = -roadZ;
  const railZ = roadX;

  const RAIL_GAUGE = 0.7175; // half gauge -> track centres at +-0.7175
  const panelTop = 0.52; // flush with rail head zone
  const roadW = 8.6; // paved crossing width across the tracks
  const corridor = 5.6; // covered along the rail direction each side

  const panels = []; // rubber deck
  const concrete = []; // approach slabs + kerbs
  const paint = [];   // markings
  const metal = [];   // gate/signal hardware
  const lamps = [];   // red lamps
  const amber = [];

  // --- flangeway panels: cover everything except 12 cm slots at the rails ---
  // panels laid in the road frame: ox along road, oz along rail corridor
  const panelSegs = [
    // [ozCentre, ozWidth]
    [-(RAIL_GAUGE + (corridor - RAIL_GAUGE) / 2 + RAIL_GAUGE), (corridor - RAIL_GAUGE)],
  ];
  void panelSegs;
  // strip widths along the rail corridor (oz from -corridor..corridor)
  const ozCuts = [
    [-corridor, -RAIL_GAUGE - 0.09],
    [-RAIL_GAUGE + 0.09, -0.14],
    [0.14, RAIL_GAUGE - 0.09],
    [RAIL_GAUGE + 0.09, corridor],
  ];
  for (const [oz0, oz1] of ozCuts) {
    const w = oz1 - oz0;
    if (w <= 0.02) continue;
    panels.push(
      localBox(roadW, panelTop, w, roadX, roadZ, sm.x, sm.y + panelTop / 2, sm.z, 0, 0, (oz0 + oz1) / 2)
    );
  }
  // deck-side ramps down to the roadway
  for (const side of [-1, 1]) {
    const ramp = new THREE.BoxGeometry(2.6, panelTop, corridor * 2);
    orientAlong(ramp, roadX, roadZ);
    ramp.translate(
      sm.x + roadX * side * (roadW / 2 + 1.2),
      sm.y + panelTop / 2 - 0.06,
      sm.z + roadZ * side * (roadW / 2 + 1.2)
    );
    panels.push(ramp);
  }

  // --- approach slabs + rumble strips + stop lines + hatch paint ---
  for (const side of [-1, 1]) {
    concrete.push(
      localBox(6.2, 0.16, roadW, roadX, roadZ, sm.x, sm.y + 0.16, sm.z, side * (roadW / 2 + 5.4), 0, 0)
    );
    // kerb blocks flanking the slab
    for (const s2 of [-1, 1]) {
      concrete.push(
        localBox(6.2, 0.34, 0.3, roadX, roadZ, sm.x, sm.y + 0.3, sm.z, side * (roadW / 2 + 5.4), 0, s2 * (roadW / 2 + 0.15))
      );
    }
    // three rumble strips
    for (let k = 0; k < 3; k++) {
      concrete.push(
        localBox(0.28, 0.1, roadW * 0.92, roadX, roadZ, sm.x, sm.y + 0.22, sm.z,
          side * (roadW / 2 + 3.0 + k * 0.75), 0, 0)
      );
    }
    // stop line
    paint.push(
      localBox(0.55, 0.025, roadW * 0.88, roadX, roadZ, sm.x, sm.y + 0.28, sm.z,
        side * (roadW / 2 + 2.2), 0, 0)
    );
    // hatched island beyond the stop line
    for (let k = 0; k < 5; k++) {
      paint.push(
        localBox(0.35, 0.025, 2.2, roadX, roadZ, sm.x, sm.y + 0.28, sm.z,
          side * (roadW / 2 + 6.4 + k * 0.72), 0, 0, )
      );
    }
  }

  // --- RR cross pavement paint (existing symbol texture) ---
  for (const side of [-1, 1]) {
    const quad = new THREE.PlaneGeometry(3.0, 3.0);
    quad.rotateX(-Math.PI / 2);
    orientAlong(quad, roadX, roadZ);
    quad.translate(
      sm.x + roadX * side * (roadW / 2 + 8.2),
      sm.y + 0.285,
      sm.z + roadZ * side * (roadW / 2 + 8.2)
    );
    paint.push(quad);
  }

  // --- equipment on both sides ---
  for (const side of [-1, 1]) {
    const gx = sm.x + railX * side * 5.4 - roadX * 0.5;
    const gz = sm.z + railZ * side * 5.4 - roadZ * 0.5;
    const ang = Math.atan2(roadX, roadZ);

    // foundation + mast
    metal.push(localBox(0.75, 0.28, 0.75, roadX, roadZ, sm.x, sm.y + 0.14, sm.z,
      -0.5 + (gx - sm.x) * roadX + (gz - sm.z) * roadZ, 0,
      (gx - sm.x) * -roadZ + (gz - sm.z) * roadX));
    const mast = new THREE.CylinderGeometry(0.09, 0.11, 3.4, 10);
    mast.translate(gx, sm.y + 1.85, gz);
    metal.push(mast);

    // bell on top
    const bell = new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    bell.translate(gx, sm.y + 3.6, gz);
    metal.push(bell);

    // wig-wag: back板 + two lamps + crossbuck + RR plate
    const backboard = new THREE.BoxGeometry(1.15, 1.35, 0.08);
    orientAlong(backboard, roadX, roadZ);
    backboard.translate(gx, sm.y + 2.95, gz);
    metal.push(backboard);

    const lampTop = new THREE.SphereGeometry(0.19, 12, 10);
    lampTop.translate(gx + roadX * 0.02, sm.y + 3.22, gz + roadZ * 0.02);
    lamps.push(lampTop);
    const lampBottom = new THREE.SphereGeometry(0.19, 12, 10);
    lampBottom.translate(gx + roadX * 0.02, sm.y + 2.68, gz + roadZ * 0.02);
    amber.push(lampBottom);

    // banner arm (the swinging red disc) beside the mast
    const banner = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 16);
    banner.rotateZ(Math.PI / 2);
    orientAlong(banner, roadX, roadZ);
    banner.translate(gx + roadX * -0.75, sm.y + 2.55, gz + roadZ * -0.75);
    metal.push(banner);

    // crossbuck X above
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const b = new THREE.BoxGeometry(1.5, 0.17, 0.06);
      orientAlong(b, roadX, roadZ);
      b.rotateX(rot);
      b.translate(gx, sm.y + 3.95, gz);
      metal.push(b);
    }

    // gate: pedestal + counterweighted boom + tip lights + skirt
    const ped = new THREE.BoxGeometry(0.62, 0.72, 0.62);
    ped.translate(gx + railX * side * 0.15, sm.y + 0.5, gz + railZ * side * 0.15);
    metal.push(ped);

    // counterweight behind the pivot
    const cw = new THREE.BoxGeometry(0.42, 0.42, 1.05);
    orientAlong(cw, roadX, roadZ);
    cw.translate(gx - roadX * 1.15, sm.y + 1.28, gz - roadZ * 1.15);
    metal.push(cw);

    // boom raised ~72 deg, pointing across the road
    const arm = new THREE.BoxGeometry(7.2, 0.17, 0.11);
    arm.translate(3.6, 0, 0);
    arm.rotateZ(-Math.PI / 2 + 0.35);
    orientAlong(arm, roadX, roadZ);
    const dirSign = side > 0 ? 1 : -1;
    arm.translate(gx + railX * dirSign * 0.1, sm.y + 1.42, gz + railZ * dirSign * 0.1);
    metal.push(arm);

    // boom tip: lights + rubber skirt
    const tipX = gx + roadX * Math.cos(0.35) * 6.8 * dirSign * 0 + railX * dirSign * 0.1 + roadX * 1.1 * dirSign;
    void tipX;
    const skirt = new THREE.BoxGeometry(1.5, 0.2, 0.12);
    orientAlong(skirt, roadX, roadZ);
    skirt.translate(gx + railX * dirSign * 0.1 + roadX * dirSign * 2.4, sm.y + 4.7, gz + railZ * dirSign * 0.1 + roadZ * dirSign * 2.4);
    metal.push(skirt);

    for (let k = 0; k < 3; k++) {
      const t = new THREE.SphereGeometry(0.11, 8, 8);
      t.translate(
        gx + railX * dirSign * 0.1 + roadX * dirSign * (1.3 + k * 1.05),
        sm.y + 4.25 + k * 0.32,
        gz + railZ * dirSign * 0.1 + roadZ * dirSign * (1.3 + k * 1.05)
      );
      lamps.push(t);
    }
    void ang;

    // advance warning board 30 m out on the approach
    const wx = sm.x + roadX * side * (roadW / 2 + 26);
    const wz = sm.z + roadZ * side * (roadW / 2 + 26);
    const wp = new THREE.CylinderGeometry(0.05, 0.06, 2.4, 8);
    wp.translate(wx, sm.y + 1.35, wz);
    metal.push(wp);
    const board = new THREE.BoxGeometry(1.75, 1.75, 0.07);
    orientAlong(board, roadX, roadZ);
    board.rotateX(Math.PI / 4);
    board.translate(wx, sm.y + 2.75, wz);
    metal.push(board);
  }

  const add = (geos, mat, name) => {
    const mesh = mergeToMesh(geos, mat, name);
    if (mesh) group.add(mesh);
  };
  add(panels, M.rubber, 'crossing-panels');
  add(concrete, M.concrete, 'crossing-approach');
  add(paint, M.paintWhite, 'crossing-paint');
  add(metal, M.metalDark, 'crossing-hardware');
  add(lamps, M.signalRed, 'crossing-lamps');
  add(amber, M.signalAmber, 'crossing-amber');

  return group;
}

/**
 * Subway: twin running tunnels, a station box, platform strip and light bands.
 * stations: [{x, z, angle, name}]
 */
export function buildSubway(subway) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = subway.name || 'Subway line';
  group.userData = { objectId: subway.id, kind: 'subway' };

  const samples = samplePolyline(subway.points, 6);
  const depth = subway.depth ?? -9;

  // twin tunnels
  const tubes = [];
  const glow = [];
  for (const off of [-3.2, 3.2]) {
    const tube = [];
    // floor
    tube.push(ribbonGeometry(samples, off - 2.6, off + 2.6, depth - 2.2, { vScale: 0.12 }));
    // walls
    tube.push(wallGeometry(samples, off - 2.6, depth - 2.2, depth + 1.6));
    tube.push(wallGeometry(samples, off + 2.6, depth - 2.2, depth + 1.6));
    // ceiling
    tube.push(ribbonGeometry(samples, off - 2.6, off + 2.6, depth + 1.6, { vScale: 0.12 }));
    tubes.push(...tube);
    // service light band along the tunnel
    glow.push(ribbonGeometry(samples, off - 0.12, off + 0.12, depth - 2.1, { vScale: 0.2 }));
  }
  const tubeMesh = mergeToMesh(tubes, M.concreteDark, `${subway.id}:tunnels`);
  if (tubeMesh) group.add(tubeMesh);
  const glowMesh = mergeToMesh(glow, M.lampGlass, `${subway.id}:lights`);
  if (glowMesh) group.add(glowMesh);

  // stations
  for (const st of subway.stations || []) {
    const station = buildStation(st, depth);
    group.add(station);
  }
  return group;
}

function buildStation(st, depth) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.position.set(st.x, 0, st.z);
  group.rotation.y = st.angle ?? 0;
  group.name = st.name || 'station';

  const boxes = [];
  const hall = new THREE.BoxGeometry(16, 6.4, 52);
  hall.translate(0, depth - 0.6, 0);
  boxes.push(hall);

  const platform = new THREE.BoxGeometry(4.4, 0.65, 48);
  platform.translate(0, depth - 1.9, 0);
  boxes.push(platform);

  const edge = [];
  for (const off of [-2.2, 2.2]) {
    const strip = new THREE.BoxGeometry(0.35, 0.04, 48);
    strip.translate(off, depth - 1.55, 0);
    edge.push(strip);
  }

  const lights = [];
  for (let z = -22; z <= 22; z += 5.5) {
    const l = new THREE.BoxGeometry(9, 0.08, 0.5);
    l.translate(0, depth + 2.2, z);
    lights.push(l);
  }

  const mesh = mergeToMesh(boxes, M.concreteDark, 'station-box');
  if (mesh) group.add(mesh);
  const edgeMesh = mergeToMesh(edge, M.paintYellow, 'platform-edge');
  if (edgeMesh) group.add(edgeMesh);
  const lightMesh = mergeToMesh(lights, M.lampGlass, 'station-lights');
  if (lightMesh) group.add(lightMesh);

  return group;
}
