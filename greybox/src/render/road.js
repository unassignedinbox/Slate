// Road tiles, portal gates, the overview route line, and the car model.
// The road is made of short slabs. The gaps between them are the fracture seams. Each tile is
// posed every frame from the same wave function the physics uses, so the car rides what you see.

import * as THREE from 'three';
import { T } from '../sim/tuning.js';

const ROAD_MATS = { street: 'roadStreet', ramp: 'roadRamp', roof: 'roadRoof', bridge: 'roadBridge' };

// Orient a unit-basis object: local +x = right, +y = up, +z = forward (along the road).
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();
function orientToRoad(obj, pose) {
  _fwd.set(pose.tx, pose.slope, pose.tz).normalize();
  _right.set(pose.tz, 0, -pose.tx).normalize();
  _up.crossVectors(_fwd, _right).normalize();
  _m.makeBasis(_right, _up, _fwd);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.set(pose.x, pose.y, pose.z);
  return _up;
}

export function buildRoads(run, shardGroups, materials) {
  const tiles = [];
  const gates = [];
  const routes = [];
  const halfW = T.roadHalfWidth;

  run.legs.forEach((leg, li) => {
    const group = shardGroups[leg.shard.id].group;
    const path = leg.path;

    // ---- road tiles
    for (const tile of path.tiles) {
      if (!tile.exists) continue;
      const len = (tile.i1 - tile.i0 + 1) * T.step;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2 * halfW, 0.8, 1), materials[ROAD_MATS[tile.type] || 'roadStreet']);
      mesh.scale.z = len - 0.35;             // the 0.35 m gap is the crack between tiles
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 1), materials.laneLine);
      line.position.y = 0.41;
      mesh.add(line);
      group.add(mesh);
      tiles.push({ mesh, path, i0: tile.i0, i1: tile.i1, sMid: ((tile.i0 + tile.i1) / 2) * T.step, len });
    }

    // ---- portal gates: entry at the leg's end, exit (arrival) at its start
    const endKind = leg.end.kind;
    const endGate = buildGate(endKind === 'finish' ? 'finish' : 'checkpoint', materials);
    group.add(endGate);
    gates.push({ obj: endGate, path, s: path.gateS, kind: 'end', leg: li });

    const startGate = buildGate(li === 0 ? 'start' : 'arrival', materials);
    group.add(startGate);
    gates.push({ obj: startGate, path, s: 0, kind: 'start', leg: li });

    // ---- route line (only visible in the overview map)
    const pts = [];
    for (let i = 0; i < path.N; i += 2) {
      const sm = path.samples[i];
      pts.push(sm.x, sm.y + 0.8, sm.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, materials.route);
    line.visible = false;
    group.add(line);
    routes.push(line);
  });

  return { tiles, gates, routes };
}

function buildGate(kind, materials) {
  const gH = T.gateHalfWidth;
  const g = new THREE.Group();
  const pillarH = 8.5;
  const pillarGeo = new THREE.BoxGeometry(1.2, pillarH, 1.2);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, materials.gateStone);
    p.position.set(sx * gH, pillarH / 2, 0);
    g.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * gH + 1.2, 1.2, 1.2), materials.gateStone);
  lintel.position.set(0, pillarH, 0);
  g.add(lintel);
  const paneMat = kind === 'finish' ? materials.finishPane : materials.gatePane;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2 * gH, pillarH - 0.8), paneMat);
  pane.position.set(0, (pillarH - 0.8) / 2, 0);
  g.add(pane);
  g.userData.kind = kind;
  return g;
}

// Per-frame: pose every tile and gate on the road at the current time.
export function updateRoads(roads, t) {
  for (const tile of roads.tiles) {
    const pose = tile.path.poseAt(tile.sMid, t);
    const up = orientToRoad(tile.mesh, pose);
    tile.mesh.position.addScaledVector(up, -0.4);   // top of the slab sits on the road surface
  }
  for (const gate of roads.gates) {
    const pose = gate.path.poseAt(gate.s, t);
    orientToRoad(gate.obj, pose);
  }
}

// Car model. Origin is at the road surface. Forward is +z, so rotation.y = heading.
export function buildCar(materials) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.2), materials.car);
  body.position.y = 0.75;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.1), materials.carCabin);
  cabin.position.set(0, 1.3, -0.2);
  car.add(cabin);
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
    wg.rotateZ(Math.PI / 2);             // axle runs along x
    const w = new THREE.Mesh(wg, materials.wheel);
    pivot.add(w);
    car.add(pivot);
    wheels.push(w);                      // spin this one about x
  }
  return { group: car, wheels };
}
