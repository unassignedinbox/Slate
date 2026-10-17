// SECTION 1 - FRACTURED TOWN. Assembles the beats onto the authored line.
import * as THREE from 'three';
import { K, PAL, MeshBuilder, lin } from '../../core/geo.js';
import { F } from '../../core/world.js';
import { LevelCtx, V3, Q } from '../ctx.js';
import { buildRoute1 } from './route1.js';
import { roadRun } from '../kit/road.js';
import { prop, FURNITURE } from '../kit/props.js';
import {
  kickerSlab, supermarket, parkingLot, shopRoof, terrace, townhouse, bridgeSpan, bridgePier,
  riverPiece, plaza, fountain, church, portalGate,
} from './structures.js';
import { streetHouses, scatterJunk, townFill, waterTower, mill, gasStation, factory, townHall, farm, pitch, homestead } from './dressing.js';

export function buildSection1(world, opts = {}) {
  const route = buildRoute1();
  const ctx = new LevelCtx({ world, route, seed: opts.seed ?? 1101, name: 'FRACTURED TOWN', section: 'S1' });
  const R = route;
  const rng = ctx.rng.fork(1);
  const dress = opts.dressing !== false;
  const beat = (id) => { ctx.beat = id; };

  // ------------------------------------------------------------ 1A APPROACH
  beat('1A');
  const startSlab = roadRun(ctx, 0, 60, { len: [60, 60], gap: [0, 0], precrack: 0, soilDepth: [6, 10], missingWalk: 0 })[0].bodies[0];
  roadRun(ctx, 60.12, 160, { len: [16, 24], gap: [0.08, 0.22], drop: [0.02, 0.05], precrack: 0.6, missingWalk: 0.05, firstDrop: 0.03 });
  // start line + grid boxes painted on the start slab (moves with it)
  {
    const mb = new MeshBuilder();
    const L = startSlab.userData.sB - startSlab.userData.sA;
    const zLine = -L / 2 + 14;
    for (let i = 0; i < 18; i++) for (let r = 0; r < 2; r++) {
      mb.box(0.5, 0.03, 0.5, new THREE.Matrix4().makeTranslation(-4.25 + i * 0.5, 0.012, zLine + r * 0.5), K.MARK, lin((i + r) % 2 ? PAL.mark : 0x2e3134));
    }
    for (const [x, z] of [[2.2, -4], [-2.2, -10]]) {
      for (const [w, d, ox, oz] of [[2.8, 0.14, 0, -3.2], [0.14, 1.2, -1.33, -2.6], [0.14, 1.2, 1.33, -2.6]]) mb.box(w, 0.03, d, new THREE.Matrix4().makeTranslation(x + ox, 0.012, zLine + z + oz), K.MARK, lin(PAL.mark));
    }
    ctx.body({ mb, pos: startSlab.basePos, quat: startSlab.baseQuat, motion: startSlab.motion, flags: F.SCENERY, name: 'start-line' });
  }

  // ------------------------------------------------------- 1B HIGH STREET
  beat('1B');
  roadRun(ctx, 160.4, 236, { len: [9, 14], gap: [0.25, 0.8], drop: [0.04, 0.13], precrack: 0.5, firstDrop: 0.06, missingWalk: 0.15, crumble: 0.15 });
  roadRun(ctx, 237.0, 310, { len: [8, 12], gap: [0.8, 1.7], drop: [0.1, 0.22], precrack: 0.5, firstDrop: 0.12, rock: 0.35, crumble: 0.3, missingWalk: 0.2, yawJitter: 0.02, latJitter: 0.6 });

  // ------------------------------------------------------------ 1C KICKER
  beat('1C');
  kickerSlab(ctx, 310, 317, { dropA: 0.04 });
  kickerSlab(ctx, 317, 326, { dropA: 0.02, pipe: true });
  ctx.label('KICKER 5°+9°  >  24 m GAP', R.pos(318).add(V3(0, 6, 0)), { kind: 'note' });

  // ----------------------------------------------------------- 1D ROOFTOPS
  beat('1D');
  const sm = supermarket(ctx, 338, 350, 472);
  if (dress) parkingLot(ctx, { pos: V3(-30, -14, -6).applyQuaternion(sm.quat).add(sm.centre), quat: sm.quat.clone().multiply(Q(0.03, 0.2, -0.05)) }, { cars: 6, carts: 8 });
  shopRoof(ctx, 475, 492);
  shopRoof(ctx, 494.5, 511.5);
  shopRoof(ctx, 514, 531);
  terrace(ctx, 534, 600);

  // ---------------------------------------------------------- 1E MILL LANE
  beat('1E');
  roadRun(ctx, 606, 734, { len: [9, 14], gap: [0.3, 1.1], drop: [0.05, 0.15], precrack: 0.5, crumble: 0.3, missingWalk: 0.15, rock: 0.2 });
  if (dress) {
    const f = R.at(668);
    waterTower(ctx, R.pos(668).add(V3(0, 14.5, 0)).addScaledVector(f.r, 1.5), Q(0.16, 1.1, -0.1), rng);
    mill(ctx, ctx.poseAt(712, -31, -5, 0, Math.PI / 2 + 0.1), rng);
  }

  // ---------------------------------------------------------- 1F THE HOUSE
  beat('1F');
  roadRun(ctx, 734.4, 799, { width: 11, walk: 3, len: [10, 15], gap: [0.25, 0.7], drop: [0.04, 0.12], precrack: 0.4, firstDrop: 0.06 });
  townhouse(ctx, 801, 831);
  if (dress) {
    prop(ctx, 'bus', ctx.poseAt(752, 15, 3.5, 0, 0.5, [0.1, 0.2]), { rng, drift: 0.3 });
    for (const [s, l] of [[740, 9], [790, -9.5], [770, 10]]) prop(ctx, 'trafficlight', ctx.poseAt(s, l, 2.4, 0, rng.range(0, 6), [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)]), { rng, drift: 0.5 });
  }

  // ---------------------------------------------------------- 1G BRIDGE
  beat('1G');
  roadRun(ctx, 841, 877, { len: [9, 13], gap: [0.3, 0.8], drop: [0.04, 0.12] });
  bridgeSpan(ctx, 877, 907, { dropA: 0.05, cutStart: 0.2 });
  bridgeSpan(ctx, 913, 953, { motion: { swell: 1, ends: true, ext: [6.3, 20], sway: { x: 1.3, z: 0.6, f: 0.22, p: 1 }, bob: { a: 0.3, f: 0.25, p: 2 }, rot: { x: 0, y: 0.004, z: 0.006, f: 0.2, p: 0 } } });
  bridgeSpan(ctx, 957, 985, { cutEnd: 0.2 });
  roadRun(ctx, 985.3, 999, { len: [14, 14], gap: [0, 0], firstDrop: 0.05 });
  ctx.label('BRIDGE: SPAN 2 DRIFTS', R.pos(933).add(V3(0, 7, 0)), { kind: 'note' });
  if (dress) {
    for (const s of [910, 955]) {
      const f = R.at(s);
      bridgePier(ctx, R.pos(s).add(V3(0, -9.5, 0)), Q(0, Math.atan2(f.t.x, f.t.z), 0.04), rng);
    }
    const f = R.at(930);
    const across = Math.atan2(f.t.x, f.t.z) + Math.PI / 2;
    for (let i = -2; i <= 2; i++) {
      const pos = R.pos(930).add(V3(0, -15 + rng.range(-2, 2), 0)).addScaledVector(f.r, i * 34 + rng.range(-4, 4)).addScaledVector(f.t, rng.range(-6, 6));
      const P = riverPiece(ctx, { pos, quat: Q(rng.range(-0.04, 0.04), across + rng.range(-0.15, 0.15), rng.range(-0.04, 0.04)) }, 22, 32, rng);
      if (rng.chance(0.6)) prop(ctx, 'boat', { pos: pos.clone().add(V3(rng.range(-6, 6), 1.5, rng.range(-6, 6))), quat: Q(0.1, rng.range(0, 6), 0.1) }, { rng, drift: 0.5 });
    }
    factory(ctx, ctx.poseAt(925, 78, -6, 0, -Math.PI / 2), rng);
  }

  // ------------------------------------------------------- 1H SOUTH STREET
  beat('1H');
  roadRun(ctx, 999.4, 1169, { len: [9, 14], gap: [0.3, 1.0], drop: [0.05, 0.15], precrack: 0.5, crumble: 0.2, rock: 0.2, missingWalk: 0.12, firstDrop: 0.06 });
  if (dress) prop(ctx, 'bus', ctx.poseAt(1085, 9.2, 2.4, 0, 0.06, [0.05, 0.12]), { rng, drift: 0.25 });

  // ------------------------------------------------------ 1I MARKET SQUARE
  beat('1I');
  const pz = plaza(ctx, 1169, 1259, { tiles: 48, margin: 15 });
  if (dress) {
    const f = R.at(1204);
    fountain(ctx, R.pos(1204).addScaledVector(f.r, 21).add(V3(0, 0.05, 0)), Q(0, rng.range(0, 1), 0), rng);
    townHall(ctx, ctx.poseAt(1215, 52, -1.5, 0, -Math.PI / 2 + 0.25), rng);
    // market stalls just outside the line, café furniture, benches, lamps
    for (let s = 1172; s < 1252; s += rng.range(6, 9)) {
      const fr = R.at(s);
      const side = s < 1236 ? 1 : rng.sign();
      prop(ctx, 'stall', ctx.poseAt(s, side * rng.range(9.5, 13), 1.6, 0, -side * Math.PI / 2 + rng.range(-0.3, 0.3), [rng.range(-0.1, 0.1), rng.range(-0.1, 0.1)]), { rng, drift: 0.4, breakable: true });
      if (rng.chance(0.6)) for (let k = 0; k < 3; k++) prop(ctx, rng.pick(['chair', 'table', 'chair', 'crate']), ctx.poseAt(s + rng.range(-3, 3), -side * rng.range(9, 15), rng.range(0.8, 3), 0, rng.range(0, 6), [rng.range(-1, 1), rng.range(-1, 1)]), { rng });
    }
    for (let i = 0; i < 8; i++) prop(ctx, rng.pick(['bench', 'lamppost', 'bin', 'bike']), ctx.poseAt(rng.range(1170, 1258), rng.sign() * rng.range(16, 26), rng.range(0.8, 3), 0, rng.range(0, 6), [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)]), { rng });
  }

  // ------------------------------------------------------- 1J CHURCH HILL
  beat('1J');
  const hill = R.beats.find((b) => b.id === '1J');
  roadRun(ctx, hill.s0 + 1.6, hill.s1, { len: [11, 16], gap: [0.25, 0.6], drop: [0.04, 0.12], precrack: 0.5, missingWalk: 0.2, yawJitter: 0.015, latJitter: 0.4 });

  // --------------------------------------------------------- 1K THE CHURCH
  beat('1K');
  const seg = (beatId, surface, k = 0) => R.segs.filter((g) => g.beat === beatId && g.surface === surface)[k];
  const nave = seg('1K', 'nave'), k1 = seg('1K', 'kicker', 0), k2 = seg('1K', 'kicker', 1), leap = seg('1K', 'air', 1);
  church(ctx, nave.s0 - 2, nave.s0, nave.s1, k1.s1, k2.s1);
  kickerSlab(ctx, k1.s0, k1.s1, { dropA: 0.02, topKind: K.STONE, topCol: PAL.pave, width: 15.6, soil: false, foundCol: PAL.stone, gmat: new THREE.Matrix4() });
  kickerSlab(ctx, k2.s0, k2.s1, { dropA: 0.02, topKind: K.STONE, topCol: PAL.pave, width: 15.6, soil: false, foundCol: PAL.stone, gmat: new THREE.Matrix4() });
  // gate sits 1.4 m below the line's end so slow leaps (~22 m/s) still make the opening; fast ones (~40) clear the lintel
  const gate = portalGate(ctx, leap.s1, { lift: -1.4 });

  // --------------------------------------------------------------- dressing
  if (dress) {
    streetHouses(ctx, 20, 160, { spacing: [30, 46], skip: 0.35, dy: [-9, 2] });
    streetHouses(ctx, 165, 310, { spacing: [18, 25], dy: [-6, 4] });
    streetHouses(ctx, 606, 734, { spacing: [18, 24], dy: [-5, 4], shops: 0.2 });
    streetHouses(ctx, 841, 877, { spacing: [20, 30], dy: [-6, 3], sides: [-1] });
    streetHouses(ctx, 999, 1169, { spacing: [17, 23], dy: [-5, 4], shops: 0.45 });
    streetHouses(ctx, hill.s0 + 2, hill.s1 - 2, { spacing: [16, 22], dy: [-3, 5] });
    gasStation(ctx, ctx.poseAt(98, -34, -4, 0, Math.PI / 2 + 0.2), rng);
    farm(ctx, ctx.poseAt(70, 62, -10, 0, 0.3), rng);
    pitch(ctx, { pos: V3(-60, -22, -150), quat: Q(0.02, 0.6, -0.03) }, rng);
    const junk = [[0, 160, 0], [160, 310, 10], [350, 600, 0], [606, 734, 10], [734, 841, 4], [841, 999, 4], [999, 1169, 10], [1169, 1259, 4], [hill.s0, hill.s1, 4]];
    for (const [a, b, inLane] of junk) scatterJunk(ctx, a, b, { inLane, every: [8, 14] });
    // the town around and beneath the line
    townFill(ctx, { x0: -300, x1: 210, y0: 4, y1: 70, z0: -390, z1: 60 }, opts.fill ?? 46, { seed: 71 });
    townFill(ctx, { x0: -320, x1: 230, y0: -40, y1: -6, z0: -400, z1: 80 }, 14, { seed: 72 });
    townFill(ctx, { x0: -280, x1: 200, y0: 76, y1: 115, z0: -380, z1: 40 }, 9, { seed: 73 });
  }

  // -------------------------------------------------------------- respawns
  const RS = [8, 110, 180, 255, 296, 368, 420, 478, 497, 517, 540, 612, 690, 744, 790, 806, 845, 880, 920, 962, 1010, 1075, 1135, 1180, 1240,
    hill.s0 + 5, hill.s0 + 45, hill.s0 + 85, nave.s0 + 4, nave.s0 + 30];
  for (const s of RS) {
    const f = R.at(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r.clone().negate(), f.u, f.t));
    ctx.respawns.push({ s, pos: f.p.clone().addScaledVector(f.u, 0.9), quat: q, speed: Math.min(R.vmax[R.index(s)], s < 20 ? 0 : 26) });
  }
  for (const b of R.beats) ctx.label(`${b.id}  ${b.name}`, R.pos(b.s0).add(V3(0, 7.5, 0)), { kind: 'beat', size: 1.2, beat: b.id });

  return { ctx, route, gate, supermarket: sm, plaza: pz };
}
