// SECTION 2 - THE TILTED CITY. Assembly: plates, streets, set pieces, city, respawns.
import * as THREE from 'three';
import { LevelCtx, V3, Q, boxP } from '../ctx.js';
import { MeshBuilder, K, lin, PAL } from '../../core/geo.js';
import { F } from '../../core/world.js';
import { groundProp } from '../kit/props.js';
import { planSection2, markS, S2 } from './layout.js';
import { cityGate, kickerRidge, towerBridge, routeQuat, leaningArch, faultDetails, plateBody, driveThroughBuilding, roadCollapse } from './structures.js';
import { StreetNet, fillBlocks } from './city.js';
import { streetEdge, abandonedCars, routeLocal, routeYaw, signalMast, spanWire, roadCracks, roadBuckles, tornAwnings, tramTracks, roadMarkings, fallenPoles, wallRubble, brokenBarriers, utilityBoxes } from './dressing.js';

export function buildSection2(world, opts = {}) {
  const pre = new LevelCtx({ world, seed: 2202 });
  const plan = planSection2(pre);
  const { map, plates, TW, route } = plan;
  const ctx = new LevelCtx({ world, route, seed: 2202, name: 'SECTION 2', section: 'S2' });
  for (const p of Object.values(plates)) p.ctx = ctx;
  const { P1a, P1b, P2, P3 } = plates;
  const rng = ctx.rng;

  // ---- keep the torn edges away from where the line crosses them
  const keepAround = (plate, s0, s1, pad = 16) => {
    for (let s = s0; s <= s1; s += 4) {
      const lp = plate.toLocal(route.pos(s));
      plate.keep.push({ x0: lp.x - pad, x1: lp.x + pad, z0: lp.z - pad, z1: lp.z + pad });
    }
  };
  const sF = markS(route, 'fault'), sK = markS(route, 'kicker'), sL = markS(route, 'lip');
  const sBE = markS(route, 'buildingEntry'), sBX = markS(route, 'buildingExit');
  const sGE = markS(route, 'garageEntry'), sGX = markS(route, 'garageExit');
  const sBS = markS(route, 'bridgeStart'), sBSE = markS(route, 'bridgeEnd');
  const sTB = markS(route, 'towerBase'), sCR = markS(route, 'crown');
  const sLS = markS(route, 'lowStreet'), sCT = markS(route, 'climbTurn'), sED = markS(route, 'edge');

  keepAround(P1a, 0, sF, 20);
  keepAround(P1b, sF, sL, 20);
  keepAround(P2, sL + 10, sCR, 20);
  keepAround(P3, sCR + 20, sED, 20);

  ctx.beat = '2A';
  P1a.build(rng.fork(11), { count: 9 });
  P1b.build(rng.fork(12), { count: 7 });
  P2.build(rng.fork(13), { count: 14 });
  P3.build(rng.fork(14), { count: 9 });

  // ---- street network
  const nets = {};
  nets.P1a = new StreetNet(P1a).routeStreet(route, 0, sF + 7);
  nets.P1b = new StreetNet(P1b).routeStreet(route, sF, sK).routeStreet(route, sK, sL, { ribbon: false });
  for (const n of [nets.P1a, nets.P1b]) {
    for (const u of [40, 130, 205, 320, 405]) n.street(map, u, -150, u, 150);
    for (const v of [-98, 98]) n.street(map, -80, v, 490, v, { hw: 9 });
  }
  // P2: the route winds through the city grid. We lay the route's street and
  // add a dense grid of side streets (visible alternative routes).
  nets.P2 = new StreetNet(P2)
    .routeStreet(route, sL + 10, sBE - 4)
    .routeStreet(route, sBX + 2, sGE - 4)
    .routeStreet(route, sGX + 2, sBS - 4)
    .routeStreet(route, sBSE + 2, sTB - 4);
  // Dense grid on P2: streets every ~60 m in both u and v
  for (const u of [540, 600, 660, 720, 780, 840, 900]) nets.P2.street(map, u, -130, u, 620);
  for (const v of [-80, -20, 40, 100, 160, 220, 300, 400, 500, 580]) nets.P2.street(map, 496, v, 920, v, { hw: 9 });
  nets.P3 = new StreetNet(P3).routeStreet(route, sCR + 2, sED);
  nets.P3.street(map, 920, 390, 920, 740).street(map, 1100, 390, 1100, 740).street(map, 1300, 390, 1300, 740);
  nets.P3.street(map, 890, 560, 1420, 560, { hw: 9 }).street(map, 890, 660, 1420, 660);
  for (const n of Object.values(nets)) n.build(ctx);

  // ---- building stock
  const occupied = [
    // keep the route corridor clear on P2
    ...routeOccupied(P2, route, sL + 10, sBE - 6, 26),
    ...routeOccupied(P2, route, sBX + 4, sGE - 6, 22),
    ...routeOccupied(P2, route, sGE - 4, sGX + 4, 22),    // garage corridor
    ...routeOccupied(P2, route, sGX + 4, sBS - 6, 22),
    ...routeOccupied(P2, route, sBS - 4, sBSE + 4, 22),   // bridge corridor
    ...routeOccupied(P2, route, sBSE + 4, sTB + 20, 24),
    ...routeOccupied(P3, route, sCR + 20, sED - 10, 22),
  ];
  const dmgOf = (rng, lot) => lot.near ? rng.range(0.25, 0.85) : rng.range(0, 0.4);

  ctx.beat = '2B';
  for (const [plate, net] of [[P1a, nets.P1a], [P1b, nets.P1b]]) {
    fillBlocks(ctx, plate, net, {
      seed: plate === P1a ? 101 : 102, occupied, len: [24, 46], deep: 56,
      pick: (lot, rng) => {
        const big = lot.hx > 13 && lot.hz > 13;
        const r = rng.next();
        if (big && r < (lot.near ? 0.62 : 0.55)) return { type: 'tower', h: rng.range(lot.near ? 70 : 90, 180), damage: dmgOf(rng, lot) };
        if (r < 0.92) return { type: 'mid', h: rng.range(20, 52), damage: dmgOf(rng, lot) };
        return { type: rng.chance(0.5) ? 'parking' : 'slab', damage: dmgOf(rng, lot) };
      },
    });
  }
  ctx.beat = '2E';
  fillBlocks(ctx, P2, nets.P2, {
    seed: 103, occupied, len: [20, 40], deep: 50,
    pick: (lot, rng) => {
      const big = lot.hx > 12 && lot.hz > 12;
      const r = rng.next();
      const dmg = lot.near ? rng.range(0.35, 0.9) : rng.range(0.1, 0.6);
      if (big && r < 0.35) return { type: 'tower', h: rng.range(50, 140), damage: dmg };
      if (r < 0.85) return { type: 'mid', damage: dmg };
      return { type: rng.chance(0.5) ? 'parking' : 'slab', damage: dmg };
    },
  });
  ctx.beat = '2N';
  fillBlocks(ctx, P3, nets.P3, {
    seed: 104, occupied, len: [14, 28], deep: 40,
    pick: (lot, rng) => {
      const r = rng.next();
      if (r < 0.64) return { type: 'low', damage: dmgOf(rng, lot) };
      if (r < 0.96) return { type: 'mid', h: rng.range(14, 30), damage: dmgOf(rng, lot) };
      return lot.hx > 10 && lot.hz > 10 ? { type: 'tower', h: rng.range(45, 75), damage: dmgOf(rng, lot) } : { type: 'low' };
    },
  });

  // ---- set pieces
  ctx.beat = '2C';
  const arch = leaningArch(ctx, P1b, map, { u: 330, vBase: 46, vRest: -52 });
  { const sA = sL - (473 - 268); ctx.crumbles.push({ sTrigger: sA, bodies: arch.shed, centre: route.pos(sA + 60), up: V3(0, 1, 0), along: route.at(sA).t.clone(), gravity: true }); }
  faultDetails(ctx, P1a, P1b, route, sF, rng.fork(21));
  ctx.beat = '2D';
  kickerRidge(ctx, P1b, sK, 3, 9);

  ctx.beat = '2H';
  // Drive-through building: the route goes through its interior (beat 2H)
  driveThroughBuilding(ctx, P2, route, sBE, sBX, rng.fork(45), { hw: 10, h: 14 });
  // Garage: the route smashes through the garage wall and drives down
  driveThroughBuilding(ctx, P2, route, sGE, sGX, rng.fork(47), { hw: 14, h: 10, garage: true });
  // Road collapse: the road ahead of the detour falls away (beat 2J)
  roadCollapse(ctx, P2, route, markS(route, 'collapse'), markS(route, 'collapse') + 40, rng.fork(46));
  // Second smaller collapse: a section of the wide avenue (beat 2I) has fallen away
  const sGrid2 = markS(route, 'grid2');
  roadCollapse(ctx, P2, route, sGrid2 + 15, sGrid2 + 30, rng.fork(48));

  // ---- falling debris: chunks of building that break off and fall as you pass
  // These are visual crumble events triggered along the route - buildings near
  // the line shed pieces that crash onto the road.
  const debrisPoints = [sL + 100, sL + 200, markS(route, 'junction') + 10, markS(route, 'alley') + 20,
    markS(route, 'grid2') + 30, markS(route, 'detour') + 10, markS(route, 'garageExit') + 5];
  for (const sD of debrisPoints) {
    if (sD > sCR - 20) continue;
    const f = route.at(sD);
    const side = rng.sign();
    const lat = side * rng.range(14, 22);
    const p = route.pos(sD).addScaledVector(f.r, -lat).addScaledVector(f.u, rng.range(-5, 5));
    const n = rng.int(2, 5);
    const bodies = [];
    for (let i = 0; i < n; i++) {
      const sz = rng.range(0.8, 2.5);
      const dm = new MeshBuilder();
      dm.box(sz, sz * rng.range(0.4, 1.2), sz * rng.range(0.5, 1.5), undefined, 10, lin(PAL.cut));
      const bp = p.clone().add(V3(rng.range(-3, 3), rng.range(6, 15), rng.range(-3, 3)));
      const b = ctx.body({ mb: dm, pos: bp, quat: Q(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)),
        motion: { swell: 1, ext: [1, 1], bob: { a: 0.3, f: 0.3, p: rng.range(0, 6) } },
        flags: F.SCENERY, name: 'debris' });
      bodies.push(b);
    }
    ctx.crumbles.push({ sTrigger: sD - 8, bodies, centre: p, up: V3(0, 1, 0), along: f.t.clone(), gravity: true });
  }

  ctx.beat = '2M';
  // The tower bridge: a flat slab on TW, oriented along the actual route direction
  // (the route crosses TW at ~66 degrees, not along the map v-axis).
  const tower = towerBridge(ctx, P2, TW, route, sTB + 20, sCR - 10, rng.fork(44), { w: 30 });
  ctx.crumbles.push({ sTrigger: sCR - 80, bodies: tower.crumbleBodies, centre: tower.centre, up: TW.n.clone(), along: route.at((sTB + sCR) / 2).t.clone(), gravity: true });

  // ---- dressing
  const r = rng.fork(31);
  ctx.beat = '2B';
  streetEdge(ctx, P1a, nets.P1a, route, 0, sF - 4, { hw: 12 });
  streetEdge(ctx, P1b, nets.P1b, route, sF + 8, sK - 6, { hw: 12 });
  abandonedCars(ctx, P1a, route, 30, sF - 6, { lanes: [-9.5, -6, 6.5, 10], cluster: 0.45, every: [14, 34] });
  abandonedCars(ctx, P1b, route, sF + 10, sK - 14, { lanes: [-9.5, -6, 6.5, 10], cluster: 0.35, every: [16, 36] });
  // P1 road cracks and markings
  roadCracks(ctx, P1a, route, 20, sF - 4, r.fork(80));
  roadCracks(ctx, P1b, route, sF + 8, sK - 6, r.fork(81));
  roadMarkings(ctx, P1a, route, 20, sF - 4, r.fork(82), { hw: 12 });
  roadMarkings(ctx, P1b, route, sF + 8, sK - 6, r.fork(83), { hw: 12 });
  // Signal masts on P1 approach
  for (let s = 40; s < sF - 10; s += rng.range(30, 50)) {
    const lp = routeLocal(P1a, route, s, rng.range(-13, -11));
    signalMast(ctx, P1a, lp.x, lp.z, routeYaw(P1a, route, s), rng.range(4, 6), r);
  }

  ctx.beat = '2E';
  streetEdge(ctx, P2, nets.P2, route, sL + 20, sBE - 6, { hw: 14, trees: false });
  streetEdge(ctx, P2, nets.P2, route, sBX + 6, sGE - 6, { hw: 12 });
  streetEdge(ctx, P2, nets.P2, route, sGX + 6, sBS - 6, { hw: 12 });
  abandonedCars(ctx, P2, route, sL + 30, sBE - 10, { lanes: [-10, -7, 7, 10], cluster: 0.5, every: [10, 24], mess: 1.2 });
  abandonedCars(ctx, P2, route, sBX + 10, sGE - 10, { lanes: [-8, -5, 5, 8], cluster: 0.4, every: [12, 28], mess: 1.5 });

  // Signal masts and span wires along P2 streets: hanging things swing plumb
  // while the leaning city tilts around them
  for (let s = sL + 40; s < sBE - 10; s += rng.range(25, 50)) {
    const lp = routeLocal(P2, route, s, rng.range(-13, -11));
    signalMast(ctx, P2, lp.x, lp.z, routeYaw(P2, route, s), rng.range(4, 7), r);
  }
  for (let s = sBX + 15; s < sGE - 10; s += rng.range(30, 55)) {
    const lp = routeLocal(P2, route, s, rng.range(-11, -9));
    signalMast(ctx, P2, lp.x, lp.z, routeYaw(P2, route, s), rng.range(4, 7), r);
  }
  for (let s = sBX + 20; s < sGE - 10; s += rng.range(40, 70)) {
    spanWire(ctx, P2, route, s, 12, r, { broken: rng.chance(0.4) });
  }
  // Cracked road surface along P2
  roadCracks(ctx, P2, route, sL + 20, sBE - 6, r.fork(51));
  roadCracks(ctx, P2, route, sBX + 6, sGE - 6, r.fork(52));
  roadCracks(ctx, P2, route, sGX + 6, sBS - 6, r.fork(53));
  roadCracks(ctx, P3, route, sCR + 30, sED - 10, r.fork(54));
  // Road buckling: heaved asphalt sections
  roadBuckles(ctx, P2, route, sL + 40, sBE - 10, r.fork(55));
  roadBuckles(ctx, P2, route, sBX + 10, sGE - 10, r.fork(56));
  roadBuckles(ctx, P3, route, sCR + 40, sED - 10, r.fork(57));
  // Torn awnings along building fronts
  tornAwnings(ctx, P2, route, sL + 20, sBE - 8, r.fork(58));
  tornAwnings(ctx, P2, route, sBX + 8, sGE - 8, r.fork(59));
  tornAwnings(ctx, P2, route, sGX + 8, sBS - 8, r.fork(60));
  // Fallen utility poles
  fallenPoles(ctx, P2, route, sL + 25, sBE - 10, r.fork(65));
  fallenPoles(ctx, P2, route, sBX + 10, sGE - 10, r.fork(66));
  fallenPoles(ctx, P2, route, sGX + 10, sBS - 10, r.fork(67));
  // Accumulated wall rubble against building walls
  wallRubble(ctx, P2, route, sL + 25, sBE - 8, r.fork(68));
  wallRubble(ctx, P2, route, sBX + 8, sGE - 8, r.fork(69));
  wallRubble(ctx, P2, route, sGX + 8, sBS - 8, r.fork(70));
  wallRubble(ctx, P3, route, sCR + 30, sED - 10, r.fork(71));
  // Broken barriers and bollards along road edges
  brokenBarriers(ctx, P2, route, sL + 20, sBE - 8, r.fork(72));
  brokenBarriers(ctx, P2, route, sBX + 8, sGE - 8, r.fork(73));
  brokenBarriers(ctx, P2, route, sGX + 8, sBS - 8, r.fork(74));
  brokenBarriers(ctx, P3, route, sCR + 30, sED - 10, r.fork(75));
  // Damaged utility boxes along streets
  utilityBoxes(ctx, P2, route, sL + 25, sBE - 8, r.fork(76));
  utilityBoxes(ctx, P2, route, sBX + 8, sGE - 8, r.fork(77));
  utilityBoxes(ctx, P2, route, sGX + 8, sBS - 8, r.fork(78));
  // Tram tracks along the boulevard
  tramTracks(ctx, P2, route, sL + 20, sBE - 8);
  // Faded road markings (lane lines, center stripes)
  roadMarkings(ctx, P2, route, sL + 20, sBE - 6, r.fork(61), { hw: 12 });
  roadMarkings(ctx, P2, route, sBX + 6, sGE - 6, r.fork(62), { hw: 10 });
  roadMarkings(ctx, P2, route, sGX + 6, sBS - 6, r.fork(63), { hw: 10 });
  roadMarkings(ctx, P3, route, sCR + 30, sED - 10, r.fork(64), { hw: 10 });
  // More abandoned cars along grid sections with heavy mess
  abandonedCars(ctx, P2, route, sGE + 10, sBS - 10, { lanes: [-9, -6, 6, 9], cluster: 0.6, every: [8, 20], mess: 2.0 });
  abandonedCars(ctx, P2, route, sBSE + 10, sTB - 10, { lanes: [-9, -6, 6, 9], cluster: 0.45, every: [10, 25], mess: 1.8 });

  ctx.beat = '2N';
  streetEdge(ctx, P3, nets.P3, route, sCR + 40, sED - 6, { hw: 12 });
  abandonedCars(ctx, P3, route, sCR + 30, sED - 20, { lanes: [-9, -6, 6, 9], cluster: 0.5, every: [10, 22], mess: 1.5 });

  // ---- rubble: broken road slabs and debris along P2 street edges
  // These give the "destroyed city" look: chunks of road, fallen walls, rubble piles
  for (let s = sL + 25; s < sTB; s += rng.range(18, 40)) {
    if (s > sBE - 8 && s < sBX + 8) continue; // skip inside drive-through building
    if (s > sGE - 8 && s < sGX + 8) continue; // skip inside garage
    if (s > sBS - 8 && s < sBSE + 8) continue; // skip bridge
    const f = route.at(s);
    const side = rng.sign();
    const lat = side * rng.range(11, 18);
    const p = route.pos(s).addScaledVector(f.r, -lat);
    // Rubble pile: a cluster of tilted concrete slabs
    const n = rng.int(2, 5);
    for (let j = 0; j < n; j++) {
      const rb = new MeshBuilder();
      const w = rng.range(1.5, 4), h = rng.range(0.2, 0.6), d = rng.range(1.5, 4);
      rb.box(w, h, d, undefined, K.CUT, lin(PAL.cut));
      const rp = p.clone().add(V3(rng.range(-3, 3), rng.range(0, 0.5), rng.range(-3, 3)));
      plateBody(ctx, P2, rb, rp.x, rp.y, rp.z, rng.range(0, 6), { rx: rng.range(-0.6, 0.6), rz: rng.range(-0.6, 0.6), name: 'rubble-slab' });
    }
    // A few props on the rubble
    for (let j = 0; j < rng.int(0, 2); j++) {
      const rp = p.clone().add(V3(rng.range(-4, 4), 0, rng.range(-4, 4)));
      groundProp(ctx, rng.pick(['chair', 'table', 'plant', 'suitcase']), P2, rp.x, rp.z, { yaw: rng.range(0, 6), rng });
    }
  }
  // ---- fallen building slabs across streets (dramatic obstacles)
  const slabSites = [sL + 80, sL + 170, markS(route, 'junction') + 5, markS(route, 'grid2') + 8,
    markS(route, 'detour') + 15, sBSE + 30];
  for (const sS of slabSites) {
    if (sS > sCR - 20) continue;
    const f = route.at(sS);
    const slabW = rng.range(8, 14), slabD = rng.range(3, 6), slabH = rng.range(0.5, 1.2);
    const smb = new MeshBuilder();
    smb.box(slabW, slabH, slabD, undefined, K.FACADE + 0.25, lin(PAL.stoneCity));
    const side = rng.sign();
    const lp = route.pos(sS).addScaledVector(f.r, -side * rng.range(4, 8));
    const tiltAngle = rng.range(0.15, 0.45) * side;
    plateBody(ctx, P2, smb, lp.x, rng.range(0.5, 2.5), lp.z, rng.range(0, 6), { rx: tiltAngle, rz: rng.range(-0.2, 0.2), name: 'fallen-slab' });
  }

  // ---- large building chunks fallen across side streets (not blocking the route
  // itself, but showing the grid streets are damaged and impassable in places)
  for (let s = sL + 60; s < sTB - 20; s += rng.range(70, 130)) {
    const f = route.at(s);
    const side = rng.sign();
    const lat = side * rng.range(20, 35);
    const p = route.pos(s).addScaledVector(f.r, -lat);
    const mb = new MeshBuilder();
    const sw = rng.range(6, 14), sh = rng.range(0.5, 1.8), sd = rng.range(3, 8);
    mb.box(sw, sh, sd, undefined, K.FACADE, lin(PAL.stoneCity));
    plateBody(ctx, P2, mb, p.x, rng.range(0.3, 2), p.z, rng.range(0, 6), { rx: rng.range(-0.5, 0.5), rz: rng.range(-0.3, 0.3), name: 'street-chunk' });
  }

  // ---- vegetation overgrowth: nature reclaiming the streets
  // Trees growing through cracks in the road, overgrown planters
  for (let s = sL + 30; s < sBE - 10; s += rng.range(40, 80)) {
    const f = route.at(s);
    const side = rng.sign();
    const lat = side * rng.range(13, 20);
    const p = route.pos(s).addScaledVector(f.r, -lat);
    if (P2.onGround(p.x, p.z, 2)) {
      const tm = new MeshBuilder();
      const trunk = lin(PAL.propDark);
      const foliage = lin(PAL.soil);
      const th = rng.range(4, 9), trad = rng.range(2, 4);
      tm.cylinder(0.2, 0.15, th, 6, T(0, th / 2, 0), K.METAL, trunk);
      tm.cylinder(trad, trad * 0.6, 2, 8, T(0, th + 1, 0), K.SOIL, foliage);
      plateBody(ctx, P2, tm, p.x, 0, p.z, rng.range(0, 6), { name: 'overgrowth-tree' });
    }
  }

  // ---- water main breaks: dark puddle patches on the road
  for (let s = sL + 50; s < sTB; s += rng.range(60, 120)) {
    const f = route.at(s);
    const lat = rng.range(-6, 6);
    const p = routeLocal(P2, route, s, lat);
    if (P2.onGround(p.x, p.z, 2)) {
      const wb = new MeshBuilder();
      const pw = rng.range(4, 10), pd = rng.range(3, 7);
      wb.box(pw, 0.03, pd, undefined, K.PLAIN, lin(0x2a3a4a));
      plateBody(ctx, P2, wb, p.x, 0.02, p.z, rng.range(0, 6), { name: 'water-puddle' });
    }
  }

  // ---- ground-level chaos: overturned objects, broken fences, scattered debris
  // These make the streets feel like a real disaster zone
  for (let s = sL + 15; s < sBE - 8; s += rng.range(8, 18)) {
    const side = rng.sign();
    const lat = side * rng.range(12, 18);
    const p = route.pos(s).addScaledVector(route.at(s).r, -lat);
    if (P2.onGround(p.x, p.z, 2)) groundProp(ctx, rng.pick(['bin', 'chair', 'suitcase', 'plant', 'mattress', 'door']), P2, p.x, p.z, { yaw: rng.range(0, 6), rng });
  }
  for (let s = sBX + 8; s < sGE - 8; s += rng.range(10, 22)) {
    const side = rng.sign();
    const lat = side * rng.range(11, 16);
    const p = route.pos(s).addScaledVector(route.at(s).r, -lat);
    if (P2.onGround(p.x, p.z, 2)) groundProp(ctx, rng.pick(['bin', 'chair', 'table', 'plant', 'suitcase', 'door', 'mattress']), P2, p.x, p.z, { yaw: rng.range(0, 6), rng });
  }
  ctx.beat = '2A';
  const arrival = cityGate(ctx, 0, P1a, { lift: 2.1, footing: 2, name: 's2-arrival-gate' });
  ctx.beat = '2P';
  const gate = cityGate(ctx, route.length, P3, { lift: -0.5, h: 12, w: 20, label: 'PORTAL  >  SECTION 3', name: 's2-exit-gate' });

  // ---- respawns
  const parentAt = (s) => {
    if (s < sL) return P1a.parent;
    if (s < sCR) return P2.parent;
    return P3.parent;
  };
  const air = (s) => {
    const a = route.at(s), b = route.at(Math.min(s + 6, route.length - 1)), c = route.at(Math.max(0, s - 3));
    return a.surface === 'air' || b.surface === 'air' || c.surface === 'air';
  };
  for (let s = 6; s < route.length - 30; s += 20) {
    if (air(s)) continue;
    const f = route.at(s);
    ctx.respawns.push({ s, pos: route.pos(s).addScaledVector(f.u, 0.9), quat: routeQuat(f), speed: Math.min(route.vmax[route.index(s)], 26), parent: parentAt(s) });
  }
  return { ctx, route, plan, arrival: { centre: arrival.centre, quat: arrival.quat, parent: arrival.parent }, gate };
}

/** Occupied rectangles along a route segment (in plate-local coordinates). */
function routeOccupied(plate, route, s0, s1, hw) {
  const out = [];
  for (let s = s0; s <= s1; s += 16) {
    const lp = plate.toLocal(route.pos(s));
    out.push({ x: lp.x, z: lp.z, hx: hw + 4, hz: hw + 4 });
  }
  return out;
}