import * as THREE from 'three';
import { Batcher, mergeInPlace } from '../util/geo.js';
import { Colliders } from '../systems/collision.js';
import { MineField } from '../props/mines.js';
import { Sentry } from '../entities/turret.js';
import {
  czechHedgehog, dragonTooth, barbedWireRun, sandbagWallRun, concreteBarricade,
  logBarricade, trenchDressing, belgianGate, rampLog, beachStake, mineSign,
} from '../props/fortify.js';
import { mgBunker, casemate, mgNest, wallTower, greatWall } from '../props/bunkers.js';
import { shermanTank, panzerTank, tankWreck, dugInTank, truckWreck } from '../props/vehicles.js';
import { ammoCrate, fuelBarrel, deadTree, rubblePile, fencePost, telegraphPole, supplyDepot } from '../props/scatter.js';
import { COURSE, WEAPONS } from '../config.js';

// ---------------------------------------------------------------------------
// Turns the layout into actual geometry, colliders and live sentries.
// Static props are merged per material by the Batcher: the whole battlefield
// (thousands of objects) ends up as a handful of draw calls.
// ---------------------------------------------------------------------------

const variants = (factory, n) => Array.from({ length: n }, (_, i) => factory(i * 7 + 3));
/** Safe (never negative) variant pick. */
const pick = (list, n) => list[((Math.round(n) % list.length) + list.length) % list.length];

export function battlefieldStages(scene, field, roads, layout) {
  const batcher = new Batcher();
  const colliders = new Colliders();
  const sentries = [];
  const statics = new THREE.Group();
  statics.name = 'battlefield';
  const Y = (x, z) => field.height(x, z);
  const out = { colliders, sentries, mineField: null, statics, gate: null };

  const stages = [];
  const stage = (label, run) => stages.push({ label, run });

  // --- obstacles -----------------------------------------------------------
  stage('Laying beach obstacles', () => {
    const hogs = variants(czechHedgehog, 5);
    for (let i = 0; i < layout.hedgehogs.length; i++) {
      const h = layout.hedgehogs[i];
      const y = Y(h.x, h.z);
      batcher.place(pick(hogs, i), h.x, y - 0.9, h.z, h.yaw, h.scale);
      colliders.add({ x: h.x, z: h.z, r: 2.1 * h.scale, kind: 'solid', damage: 0.5 });
    }
    const gate = belgianGate();
    const ramp = rampLog();
    const stakes = variants(beachStake, 4);
    for (const o of layout.beachObstacles) {
      const y = Y(o.x, o.z);
      if (o.kind === 'gate') {
        batcher.place(gate, o.x, y, o.z, o.yaw);
        colliders.add({ x: o.x, z: o.z, r: 2.4, kind: 'solid', damage: 0.6 });
      } else if (o.kind === 'ramp') {
        batcher.place(ramp, o.x, y, o.z, o.yaw + Math.PI);
        colliders.add({ x: o.x, z: o.z, r: 1.6, kind: 'solid', damage: 0.5 });
      } else {
        batcher.place(pick(stakes, o.x), o.x, y, o.z, o.yaw);
        colliders.add({ x: o.x, z: o.z, r: 0.7, kind: 'soft', damage: 0.12 });
      }
    }
  });

  stage('Pouring dragon\u2019s teeth', () => {
    const teeth = variants(dragonTooth, 6);
    for (let i = 0; i < layout.dragonTeeth.length; i++) {
      const t = layout.dragonTeeth[i];
      batcher.place(pick(teeth, i), t.x, Y(t.x, t.z) - 0.25, t.z, t.yaw, t.scale);
      colliders.add({ x: t.x, z: t.z, r: 1.15 * t.scale, kind: 'solid', damage: 0.75 });
    }
    const conc = variants((s) => concreteBarricade(9, s), 3);
    const logs = variants((s) => logBarricade(8, s), 3);
    for (let i = 0; i < layout.barricades.length; i++) {
      const b = layout.barricades[i];
      const proto = b.kind === 'log' ? pick(logs, i) : pick(conc, i);
      batcher.place(proto, b.x, Y(b.x, b.z) - 0.1, b.z, b.yaw);
      const half = (b.len || 9) / 2;
      colliders.addLine(
        b.x - Math.cos(b.yaw) * half, b.z + Math.sin(b.yaw) * half,
        b.x + Math.cos(b.yaw) * half, b.z - Math.sin(b.yaw) * half,
        1.3, { kind: 'solid', damage: 0.7 },
      );
    }
  });

  stage('Rolling out barbed wire', () => {
    for (const run of layout.wire) {
      const pts = run.points.map((p) => ({ x: p.x, y: Y(p.x, p.z), z: p.z }));
      const mesh = barbedWireRun(pts, run.kind, (pts[0].x * 13) | 0);
      batcher.add(mesh);
      for (let i = 0; i < pts.length - 1; i++) {
        colliders.addLine(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, 1.5, { kind: 'wire', damage: 0.2 }, 3);
      }
    }
  });

  stage('Filling sandbags', () => {
    for (const wall of layout.sandbags) {
      const pts = wall.points.map((p) => ({ x: p.x, y: Y(p.x, p.z), z: p.z }));
      batcher.add(sandbagWallRun(pts, wall.height, (pts[0].z * 7) | 0));
      for (let i = 0; i < pts.length - 1; i++) {
        colliders.addLine(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, 1.4, { kind: 'soft', damage: 0.5 }, 2.2);
      }
    }
  });

  stage('Revetting trenches', () => {
    for (const tr of layout.trenches) {
      for (let i = 0; i < tr.points.length - 1; i++) {
        const a = tr.points[i];
        const b = tr.points[i + 1];
        const ay = Y(a.x, a.z) + tr.depth;
        const by = Y(b.x, b.z) + tr.depth;
        batcher.add(trenchDressing(a.x, ay, a.z, b.x, by, b.z, tr.width * 0.5, tr.depth, i + 1));
      }
    }
  });

  // --- strongpoints --------------------------------------------------------
  stage('Building bunkers and gun positions', () => {
    const protos = {
      mg: variants(mgBunker, 3),
      casemate: variants(casemate, 2),
      nest: variants(mgNest, 2),
    };
    let i = 0;
    for (const b of layout.bunkers) {
      i++;
      let proto;
      let sink = 0;
      let arc = 1.2;
      let range = WEAPONS.mgRange;
      if (b.kind === 'casemate') {
        proto = pick(protos.casemate, i);
        arc = 0.85;
        range = WEAPONS.mgRange * 1.15;
      } else if (b.kind === 'nest') {
        proto = pick(protos.nest, i);
        arc = 1.5;
      } else if (b.kind === 'wallmg') {
        proto = wallTower(b.height || 22);
        arc = 1.1;
        range = WEAPONS.mgRange * 1.25;
      } else {
        proto = pick(protos.mg, i);
        if (b.dug) sink = 1.1;
      }
      const y = Y(b.x, b.z) - sink;
      batcher.place(proto, b.x, y, b.z, b.yaw);

      const radius = b.kind === 'casemate' ? 7 : b.kind === 'nest' ? 4.6 : 4.8;
      colliders.add({ x: b.x, z: b.z, r: radius, kind: 'solid', damage: 1.0 });

      // live MG in the embrasure
      const mount = proto.userData.mount.clone();
      const world = new THREE.Vector3(
        b.x + Math.sin(b.yaw) * mount.z + Math.cos(b.yaw) * mount.x,
        y + mount.y,
        b.z + Math.cos(b.yaw) * mount.z - Math.sin(b.yaw) * mount.x,
      );
      const sentry = new Sentry(world, b.yaw, field, {
        arc,
        range,
        skill: b.kind === 'casemate' || b.kind === 'wallmg' ? 1.0 : 0.78,
      });
      sentries.push(sentry);
      scene.add(sentry.model);
    }
  });

  stage('Raising the wall', () => {
    const spec = layout.wall;
    // origin at the gate's own ground level; every panel is founded on the
    // terrain beneath it while the crest stays level
    const baseY = Y(0, spec.z);
    const wall = greatWall(spec, (x) => Y(x, spec.z) - baseY);
    batcher.place(wall, 0, baseY, spec.z, 0);

    // colliders across the whole face, leaving the gate open
    const half = spec.gateWidth / 2;
    colliders.addLine(-spec.halfWidth, spec.z, -half - 1.5, spec.z, 6, { kind: 'solid', damage: 2 }, 8);
    colliders.addLine(half + 1.5, spec.z, spec.halfWidth, spec.z, 6, { kind: 'solid', damage: 2 }, 8);
    colliders.add({ x: -half - 2.2, z: spec.z, r: 2.5, kind: 'solid', damage: 2 });
    colliders.add({ x: half + 2.2, z: spec.z, r: 2.5, kind: 'solid', damage: 2 });

    out.gate = new THREE.Vector3(0, Y(0, COURSE.gateZ), COURSE.gateZ);
  });

  // --- armour & dressing ---------------------------------------------------
  stage('Parking armour', () => {
    const protoSherman = variants(shermanTank, 3);
    const protoPanzer = variants(panzerTank, 3);
    const protoWreck = variants(tankWreck, 3);
    const protoDug = variants(dugInTank, 2);
    let i = 0;
    for (const t of layout.tanks) {
      i++;
      let proto;
      if (t.kind === 'wreck') proto = pick(protoWreck, i);
      else if (t.kind === 'dugin') proto = pick(protoDug, i);
      else if (t.kind === 'panzer') proto = pick(protoPanzer, i);
      else proto = pick(protoSherman, i);
      const y = Y(t.x, t.z);
      batcher.place(proto, t.x, y, t.z, t.yaw);
      // two capsules along the hull so you can't clip a corner
      const fx = Math.sin(t.yaw) * 1.7;
      const fz = Math.cos(t.yaw) * 1.7;
      colliders.add({ x: t.x + fx, z: t.z + fz, r: 2.0, kind: 'solid', damage: 1.1 });
      colliders.add({ x: t.x - fx, z: t.z - fz, r: 2.0, kind: 'solid', damage: 1.1 });
    }
  });

  stage('Scattering wreckage', () => {
    const protos = {
      crate: variants(ammoCrate, 5),
      barrel: variants(fuelBarrel, 4),
      deadTree: variants(deadTree, 5),
      rubble: variants(rubblePile, 5),
      post: variants(fencePost, 3),
      telegraph: variants(telegraphPole, 4),
      truckWreck: variants(truckWreck, 3),
    };
    let i = 0;
    for (const p of layout.props) {
      i++;
      const list = protos[p.kind];
      if (!list) continue;
      const y = Y(p.x, p.z);
      batcher.place(pick(list, i), p.x, y, p.z, p.yaw, p.scale || 1);
      if (p.kind === 'truckWreck') {
        colliders.add({ x: p.x, z: p.z, r: 2.4, kind: 'solid', damage: 0.8 });
      } else if (p.kind === 'crate' || p.kind === 'barrel') {
        colliders.add({ x: p.x, z: p.z, r: 0.75, kind: 'soft', damage: 0.25 });
      } else if (p.kind === 'deadTree' || p.kind === 'telegraph') {
        colliders.add({ x: p.x, z: p.z, r: 0.55, kind: 'solid', damage: 0.7 });
      }
    }
    const sign = mineSign();
    for (const s of layout.signs) batcher.place(sign, s.x, Y(s.x, s.z), s.z, s.yaw);

    // repair dumps stay un-merged: they get removed when collected
    const depotGroup = new THREE.Group();
    depotGroup.name = 'depots';
    out.depots = [];
    layout.depots.forEach((d, k) => {
      const model = supplyDepot(k + 7);
      const y = Y(d.x, d.z);
      model.position.set(d.x, y, d.z);
      model.rotation.y = d.yaw;
      mergeInPlace(model);
      depotGroup.add(model);
      out.depots.push({ x: d.x, z: d.z, y, model, taken: false });
    });
    scene.add(depotGroup);
    out.depotGroup = depotGroup;
  });

  stage('Arming mines', () => {
    const mines = layout.mines.map((m) => {
      const y = field.height(m.x, m.z);
      const n = field.normal(m.x, m.z);
      return {
        ...m,
        y,
        tiltX: Math.atan2(-n.z, n.y) * 0.8,
        tiltZ: Math.atan2(n.x, n.y) * 0.8,
      };
    });
    out.mineField = new MineField(mines);
    scene.add(out.mineField.group);
  });

  stage('Finalising', () => {
    const merged = batcher.build('battlefield');
    statics.add(merged);
    scene.add(statics);
  });

  return { stages, result: out };
}
