/**
 * Bakes real poses out of the running rig to OBJ so they can be rendered
 * and inspected. The poses come from the actual agent, not from a
 * hand-authored test scene, so what you see is what the browser shows.
 *
 *   node tools/snapshot.mjs <outdir>
 */
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';
import { params } from '../src/core/params.js';
import { buildMosquito } from '../src/mosquito/mosquito.js';
import { MosquitoAgent, STATE } from '../src/mosquito/agent.js';
import { Vehicle } from '../src/scene/vehicle.js';

const outdir = process.argv[2] || '/tmp/snaps';
fs.mkdirSync(outdir, { recursive: true });

const fakeScene = new THREE.Group();
const vehicle = new Vehicle(fakeScene);
vehicle.group.parent = fakeScene;

const rig = buildMosquito(params.shape);
const agent = new MosquitoAgent(rig, params.shape, params.mech, vehicle);

/** Walk a subtree and write every mesh out in world space, grouped by material. */
function writeOBJ(roots, file) {
  roots.forEach((r) => r.updateMatrixWorld(true));
  const lines = [];
  let vbase = 1;
  const groups = new Map();
  const nrm = new THREE.Matrix3();
  const v = new THREE.Vector3();

  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let vis = true;
      o.traverseAncestors((a) => { if (!a.visible) vis = false; });
      if (!vis) return;
      const g = o.geometry;
      const pos = g.attributes.position;
      if (!pos) return;
      const matName = (o.material && o.material.name) || 'm' + (o.material?.uuid || '').slice(0, 6);
      if (!groups.has(matName)) groups.set(matName, []);
      const faces = groups.get(matName);
      nrm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
      }
      const idx = g.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const a = (idx ? idx.getX(i) : i) + vbase;
        const b = (idx ? idx.getX(i + 1) : i + 1) + vbase;
        const c = (idx ? idx.getX(i + 2) : i + 2) + vbase;
        faces.push(`f ${a} ${b} ${c}`);
      }
      vbase += pos.count;
    });
  }
  const out = [...lines];
  for (const [m, faces] of groups) {
    // 'o' (not 'g') so Blender's importer splits them into named objects
    out.push(`o ${m}`, `usemtl ${m}`, ...faces);
  }
  fs.writeFileSync(file, out.join('\n'));
  return { verts: vbase - 1, groups: groups.size };
}

/** Give every material a stable name so the OBJ groups are meaningful. */
function nameMaterials() {
  const M = rig.materials;
  for (const [k, v] of Object.entries(M)) if (v && v.isMaterial) v.name = k;
  rig.root.traverse((o) => {
    if (o.isMesh && o.material && !o.material.name) o.material.name = 'wing';
  });
  vehicle.group.traverse((o) => {
    if (o.isMesh && o.material && !o.material.name) o.material.name = 'vehicle';
  });
}
nameMaterials();

const dt = 1 / 240;
function runUntil(pred, maxS = 90) {
  for (let i = 0; i < maxS / dt; i++) {
    agent.update(dt);
    agent.events.length = 0;
    if (pred(agent, i)) return true;
  }
  return false;
}

/**
 * Writes immediately. The rig is a live object graph - stashing a
 * reference and serialising later gives you six copies of the last pose.
 */
function shoot(name, roots) {
  const f = path.join(outdir, name + '.obj');
  const info = writeOBJ(roots, f);
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.root);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  fs.writeFileSync(f.replace('.obj', '.json'), JSON.stringify({
    center: c.toArray(), size: sz.toArray(), max: Math.max(sz.x, sz.y, sz.z),
  }));
  console.log(`${name}: ${info.verts} verts, ${info.groups} groups, bbox ${sz.x.toFixed(2)}x${sz.y.toFixed(2)}x${sz.z.toFixed(2)}`);
}

// 0 - canonical: origin, identity orientation, so the anatomy and the
//     flight leg pose can be judged without the world transform in the way
runUntil((a) => a.state === STATE.CRUISE && a.t > 1.0 && Math.abs((a.wingPhase % 1) - 0.25) < 0.01);
const savePos = agent.pos.clone();
rig.root.position.set(0, 0, 0);
rig.orient.quaternion.identity();
rig.body.position.set(0, 0, 0);
shoot('00_canonical_flight', [rig.root]);
rig.root.position.copy(savePos);

// 1 - cruise, wings mid-downstroke so the stroke is legible
shoot('01_cruise_mid_downstroke', [rig.root]);

// 2 - wings at the top of the stroke, fully supinated
runUntil((a) => Math.abs((a.wingPhase % 1) - 0.0) < 0.01);
shoot('02_cruise_stroke_top', [rig.root]);

// 3 - on final approach with the hind legs reaching
if (!runUntil((a) => a.state === STATE.LAND && a.stateTime > 0.15)) throw new Error('never reached the landing reach');
shoot('03_landing_reach', [rig.root, vehicle.group]);

// 3b - mid-gait, one tripod in swing
if (!runUntil((a) => a.state === STATE.WALK && a.stateTime > 0.30 && a.stateTime < 0.34)) throw new Error('never reached mid-gait');
shoot('03b_walk_midstep', [rig.root, vehicle.group]);

// 4 - settled at the Anopheles 45 degree rest angle, probing
if (!runUntil((a) => a.state === STATE.PROBE && a.stateTime > 0.9)) throw new Error('never reached the probing pose');
shoot('04_probing', [rig.root, vehicle.group]);

// 5 - labium buckled, fascicle driven in, boring
if (!runUntil((a) => a.state === STATE.DRILL && a.b.extend > 0.55)) throw new Error('never reached the drilling pose');
shoot('05_drilling', [rig.root, vehicle.group]);

// 5b - head only: the mouthparts are the whole point, so frame them
shoot('05b_mouthparts', [rig.head]);

// 6 - engorged
if (!runUntil((a) => a.state === STATE.FEED && a.load > params.mech.crawCapacity * 0.9)) throw new Error('never reached the engorged pose');
shoot('06_engorged', [rig.root, vehicle.group]);

// 7 - the stroke-blur fan at a real mosquito wingbeat
params.mech.wingbeatHz = 600;
runUntil((a) => a.state === STATE.TAKEOFF || a.state === STATE.CRUISE, 40);
for (let i = 0; i < 400; i++) { agent.update(1 / 60); agent.events.length = 0; }
rig.root.position.set(0, 0, 0);
rig.orient.quaternion.identity();
rig.body.position.set(0, 0, 0);
shoot('07_stroke_blur', [rig.root]);

console.log('done');
