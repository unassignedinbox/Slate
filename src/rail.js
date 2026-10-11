// Railway (tracks, ballast, level crossings) and subway (tunnels, stations).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterials } from './materials.js';
import { samplePolyline, sampleAt, ribbonGeometry, wallGeometry, polylineSampleLength } from './roadbuilder.js';

function mergeToMesh(geos, mat, name = 'rail') {
  const usable = geos.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
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

/** Road surface panels + ramps + gates + signals where a road crosses the track. */
function buildLevelCrossing(samples, crossing) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = 'level-crossing';
  const sm = sampleAt(samples, crossing.s);
  // road direction across the tracks
  let roadX = crossing.roadDirX ?? 1;
  let roadZ = crossing.roadDirZ ?? 0;
  const rLen = Math.hypot(roadX, roadZ) || 1;
  roadX /= rLen;
  roadZ /= rLen;
  // perpendicular (along the rail corridor)
  const railX = -roadZ;
  const railZ = roadX;

  // deck: rubber panels raised to rail height + approach ramps
  const panels = [];
  const paint = [];
  const panelW = 12.5; // along the road
  const panelD = 8.2;  // across (along the rail corridor)

  const deck = new THREE.BoxGeometry(panelW, 0.52, panelD);
  orientAlong(deck, roadX, roadZ);
  deck.translate(sm.x, sm.y + 0.26, sm.z);
  panels.push(deck);

  for (const side of [-1, 1]) {
    const ramp = new THREE.BoxGeometry(3.6, 0.5, panelD);
    orientAlong(ramp, roadX, roadZ);
    ramp.translate(
      sm.x + roadX * side * (panelW / 2 + 1.6),
      sm.y + 0.12,
      sm.z + roadZ * side * (panelW / 2 + 1.6)
    );
    panels.push(ramp);

    // RR-cross pavement paint on the approaches
    const quad = new THREE.PlaneGeometry(3.2, 3.2);
    quad.rotateX(-Math.PI / 2);
    orientAlong(quad, roadX, roadZ);
    quad.translate(
      sm.x + roadX * side * (panelW / 2 + 4.6),
      sm.y + 0.2,
      sm.z + roadZ * side * (panelW / 2 + 4.6)
    );
    paint.push(quad);
  }

  const panelMesh = mergeToMesh(panels, M.rubber, 'crossing-panels');
  if (panelMesh) group.add(panelMesh);
  const paintMesh = mergeToMesh(paint, M.symbolRail, 'crossing-paint');
  if (paintMesh) group.add(paintMesh);

  // gates + signals on both sides of the road
  for (const side of [-1, 1]) {
    const gx = sm.x + railX * side * 5.0 - roadX * 0.4;
    const gz = sm.z + railZ * side * 5.0 - roadZ * 0.4;

    const mast = [];
    const post = new THREE.CylinderGeometry(0.11, 0.13, 1.15, 10);
    post.translate(gx, sm.y + 0.58, gz);
    mast.push(post);
    const head = new THREE.BoxGeometry(0.42, 0.55, 0.42);
    head.translate(gx, sm.y + 1.35, gz);
    mast.push(head);
    const mastMesh = mergeToMesh(mast, M.metalDark, 'gate-mast');
    if (mastMesh) group.add(mastMesh);

    const beacon = mergeToMesh([new THREE.SphereGeometry(0.13, 10, 10)], M.signalRed, 'gate-beacon');
    if (beacon) {
      beacon.position.set(gx + railX * side * 0.24, sm.y + 1.38, gz + railZ * side * 0.24);
      group.add(beacon);
    }

    // boom raised ~72 degrees
    const arm = new THREE.BoxGeometry(5.2, 0.16, 0.1);
    arm.translate(2.6, 0, 0);
    arm.rotateZ(-Math.PI / 2 + 0.32);
    orientAlong(arm, roadX, roadZ);
    arm.translate(gx, sm.y + 1.5, gz);
    const armMesh = mergeToMesh([arm], M.gateStripes, 'gate-arm');
    if (armMesh) group.add(armMesh);

    // twin-lamp signal beside the gate
    const sig = [];
    const sx = gx + roadX * 2.4;
    const sz = gz + roadZ * 2.4;
    const sp = new THREE.CylinderGeometry(0.06, 0.075, 3.1, 8);
    sp.translate(sx, sm.y + 1.55, sz);
    sig.push(sp);
    const sb = new THREE.BoxGeometry(0.62, 0.62, 0.14);
    orientAlong(sb, roadX, roadZ);
    sb.translate(sx, sm.y + 3.05, sz);
    sig.push(sb);
    const sigMesh = mergeToMesh(sig, M.metalDark, 'signal-post');
    if (sigMesh) group.add(sigMesh);

    const lamps = [];
    for (const off of [-0.15, 0.15]) {
      const lamp = new THREE.SphereGeometry(0.12, 10, 10);
      lamp.translate(sx + railX * off, sm.y + 3.05, sz + railZ * off);
      lamps.push(lamp);
    }
    const lampMesh = mergeToMesh(lamps, M.signalRed, 'signal-lamps');
    if (lampMesh) group.add(lampMesh);

    // crossbuck X
    const xb = [];
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const b = new THREE.BoxGeometry(1.25, 0.15, 0.05);
      orientAlong(b, roadX, roadZ);
      b.rotateX(rot);
      b.translate(sx, sm.y + 2.45, sz);
      xb.push(b);
    }
    const xbMesh = mergeToMesh(xb, M.paintWhite, 'crossbuck');
    if (xbMesh) group.add(xbMesh);
  }

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
