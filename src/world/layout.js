import { makeRNG } from '../util/mathx.js';
import { WORLD, COURSE } from '../config.js';

// ---------------------------------------------------------------------------
// The battlefield layout.
//
// This is authored sector by sector along the road, not sprinkled at random:
// every strongpoint covers a piece of road, every obstacle belt has a gap that
// is itself covered by fire, and the mine belts punish the obvious shortcuts.
// Positions are pure XZ - the Field decides the elevation later, so nothing
// can end up floating.
// ---------------------------------------------------------------------------

export function buildLayout(roads) {
  const rng = makeRNG(WORLD.seed);
  const main = roads.main;

  const L = {
    mounds: [],
    craters: [],
    trenches: [],
    bunkers: [],
    wire: [],
    sandbags: [],
    hedgehogs: [],
    dragonTeeth: [],
    barricades: [],
    mines: [],
    tanks: [],
    props: [],        // { kind, x, z, yaw, scale }
    signs: [],
    depots: [],       // { x, z, yaw } field repair points
    beachObstacles: [],
    wall: null,
  };

  // --- helpers -------------------------------------------------------------

  const P = (t, lateral = 0, path = main) => {
    const s = path.at(t);
    return { x: s.x + s.nx * lateral, z: s.z + s.nz * lateral, yaw: Math.atan2(s.dx, s.dz) };
  };

  const faceTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

  /** X-ranges where any road crosses this Z line (so belts can leave gaps). */
  const roadGapsAtZ = (z, pad = 7) => {
    const gaps = [];
    for (const path of roads.paths) {
      for (const s of path.samples) {
        if (Math.abs(s.z - z) < 6) {
          const half = s.width * 0.5 + pad;
          gaps.push([s.x - half, s.x + half]);
        }
      }
    }
    gaps.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const g of gaps) {
      const last = merged[merged.length - 1];
      if (last && g[0] <= last[1] + 4) last[1] = Math.max(last[1], g[1]);
      else merged.push([...g]);
    }
    return merged;
  };

  /**
   * Build a belt running across the battlefield at depth `z`, broken where the
   * roads pass through. `shape(x)` returns a z offset so belts can zigzag.
   */
  const crossBelt = (z, { from = -340, to = 340, step = 12, pad = 7, shape = null, extraGaps = [] } = {}) => {
    const gaps = roadGapsAtZ(z, pad).concat(extraGaps);
    const blocked = (x) => gaps.some(([a, b]) => x > a && x < b);
    const runs = [];
    let cur = null;
    for (let x = from; x <= to; x += step) {
      if (blocked(x)) {
        if (cur && cur.length > 1) runs.push(cur);
        cur = null;
        continue;
      }
      if (!cur) cur = [];
      const dz = shape ? shape(x) : rng.range(-2.5, 2.5);
      cur.push({ x, z: z + dz });
    }
    if (cur && cur.length > 1) runs.push(cur);
    return runs;
  };

  const addMound = (x, z, r, h) => L.mounds.push({ x, z, r, h });
  const addCrater = (x, z, r, d) => L.craters.push({ x, z, r, d });

  const addBunker = (x, z, yaw, kind = 'mg', opts = {}) => {
    const b = { x, z, yaw, kind, ...opts };
    L.bunkers.push(b);
    // bank earth around the position so it is bedded into the ground rather
    // than sitting on it like a shoebox
    const back = kind === 'casemate' ? 11 : 8;
    const r = kind === 'casemate' ? 17 : 13;
    L.mounds.push({ x: x - Math.sin(yaw) * back, z: z - Math.cos(yaw) * back, r, h: kind === 'casemate' ? 4.2 : 3.0 });
    L.mounds.push({ x: x + Math.cos(yaw) * (r * 0.55), z: z - Math.sin(yaw) * (r * 0.55), r: r * 0.75, h: 2.3 });
    L.mounds.push({ x: x - Math.cos(yaw) * (r * 0.55), z: z + Math.sin(yaw) * (r * 0.55), r: r * 0.75, h: 2.3 });
    return b;
  };

  const addProp = (kind, x, z, yaw = rng.range(0, Math.PI * 2), scale = 1) =>
    L.props.push({ kind, x, z, yaw, scale });

  /** Scatter mines inside a disc, never on a drivable carriageway unless asked. */
  const mineField = (cx, cz, radius, count, kind = 'ap', { onRoad = false, roadClear = 9 } = {}) => {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 24) {
      const a = rng.range(0, Math.PI * 2);
      const r = radius * Math.sqrt(rng());
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (Math.abs(x) > WORLD.halfWidth - 40) continue;
      const hit = roads.nearest(x, z, 40);
      const onCarriageway = hit && hit.dist < hit.sample.width * 0.5 + roadClear;
      if (!onRoad && onCarriageway) continue;
      L.mines.push({ x, z, kind, yaw: rng.range(0, Math.PI * 2) });
      placed++;
    }
  };

  /** Mines laid deliberately across a carriageway at a chokepoint. */
  const roadMines = (t, kind, lats, path = main) => {
    for (const lat of lats) {
      const p = P(t, lat, path);
      L.mines.push({ x: p.x, z: p.z, kind, yaw: rng.range(0, Math.PI * 2) });
    }
  };

  const hedgehogLine = (ax, az, bx, bz, count, jitter = 2.5) => {
    for (let i = 0; i < count; i++) {
      const k = count === 1 ? 0.5 : i / (count - 1);
      L.hedgehogs.push({
        x: ax + (bx - ax) * k + rng.range(-jitter, jitter),
        z: az + (bz - az) * k + rng.range(-jitter, jitter),
        yaw: rng.range(0, Math.PI * 2),
        scale: rng.range(0.9, 1.25),
      });
    }
  };

  const sandbagWall = (points, height = 3, thickness = 2.2) =>
    L.sandbags.push({ points, height, thickness });

  const ringOf = (cx, cz, radius, from, to, segs = 10) => {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = from + (to - from) * (i / segs);
      pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
    }
    return pts;
  };

  // =========================================================================
  // SECTOR 0 - the surf and the open beach
  // =========================================================================
  // Beach obstacles in the tidal zone: hedgehogs, Belgian gates and ramp logs
  // with shells wired to them. They are the first thing the tide swallows.
  for (let row = 0; row < 5; row++) {
    const z = 268 - row * 26;
    hedgehogLine(-300, z, 300, z + rng.range(-6, 6), 15 + row, 6);
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-320, 320);
    const z = rng.range(120, 290);
    L.beachObstacles.push({ kind: rng.pick(['gate', 'ramp', 'stake', 'stake']), x, z, yaw: rng.range(-0.4, 0.4) });
  }
  // dunes above the high-water mark
  for (let i = 0; i < 16; i++) {
    const x = rng.range(-340, 340);
    const z = rng.range(60, 150);
    addMound(x, z, rng.range(28, 52), rng.range(2.2, 5.5));
  }
  for (const run of crossBelt(104, { step: 10, pad: 11 })) L.wire.push({ points: run, kind: 'concertina' });
  mineField(-210, 60, 70, 26, 'ap');
  mineField(150, 44, 66, 24, 'ap');
  L.signs.push({ x: -150, z: 72, yaw: 0.2, kind: 'mine' }, { x: 132, z: 58, yaw: -0.3, kind: 'mine' });

  // drowned armour on the beach
  L.tanks.push(
    { x: -244, z: 196, yaw: 1.1, kind: 'wreck' },
    { x: 96, z: 236, yaw: -0.6, kind: 'wreck' },
    { x: 268, z: 150, yaw: 2.4, kind: 'wreck' },
  );
  for (let i = 0; i < 14; i++) addProp('crate', rng.range(-320, 320), rng.range(100, 280), rng.range(0, 6.28));
  for (let i = 0; i < 10; i++) addProp('rubble', rng.range(-330, 330), rng.range(80, 300));

  // The beach belts are laid blind across the sand, but the engineers blew a
  // gap where the exit track runs - otherwise there is no way off the beach.
  const clearOfRoad = (o, pad) => {
    const hit = roads.nearest(o.x, o.z, 40);
    return !hit || hit.dist > hit.sample.width * 0.5 + pad;
  };
  L.hedgehogs = L.hedgehogs.filter((h) => clearOfRoad(h, 3.5));
  L.beachObstacles = L.beachObstacles.filter((o) => clearOfRoad(o, 3));

  // =========================================================================
  // SECTOR 1 - the beach exit / the draw (t 0.06 - 0.16)
  // =========================================================================
  {
    const gate = P(0.10);
    addMound(gate.x - 78, gate.z + 16, 62, 13);
    addMound(gate.x + 84, gate.z - 10, 66, 15);

    const bL = P(0.105, 62);
    const bR = P(0.10, -66);
    addBunker(bL.x, bL.z, faceTo(bL, P(0.055)), 'mg', { dug: true });
    addBunker(bR.x, bR.z, faceTo(bR, P(0.06)), 'mg', { dug: true });
    sandbagWall(ringOf(bL.x, bL.z, 11, -0.6, 2.4, 9), 2.6);
    sandbagWall(ringOf(bR.x, bR.z, 11, 1.1, 4.2, 9), 2.6);

    // fire trench linking the two positions, dug back from the crest
    const tz = P(0.12).z;
    for (const run of crossBelt(tz, { step: 14, pad: 13, from: -230, to: 230, shape: (x) => (Math.floor(x / 26) % 2 ? 8 : -8) })) {
      L.trenches.push({ points: run, width: 13, depth: 4.4, revetted: true });
    }

    // chicane: concrete blocks narrowing the road, alternating sides
    for (let i = 0; i < 4; i++) {
      const t = 0.13 + i * 0.006;
      const lat = i % 2 ? 4.5 : -4.5;
      const p = P(t, lat);
      L.barricades.push({ x: p.x, z: p.z, yaw: p.yaw + 0.35 * (i % 2 ? 1 : -1), kind: 'concrete', len: 9 });
    }
    roadMines(0.145, 'ap', [-3.5, 2.5, 5.5]);
    mineField(gate.x - 120, gate.z - 40, 58, 22, 'ap');
  }

  // =========================================================================
  // SECTOR 2 - the crossroads, wrecked convoy, first tank mines (t 0.17-0.28)
  // =========================================================================
  {
    const c = P(0.21);
    for (let i = 0; i < 9; i++) {
      addCrater(c.x + rng.range(-70, 70), c.z + rng.range(-70, 70), rng.range(10, 18), rng.range(2.4, 4.6));
    }
    addCrater(P(0.225, 3).x, P(0.225, 3).z, 11, 2.4); // crater eating the road
    addMound(c.x + 96, c.z + 28, 58, 12);

    const nest = P(0.20, -48);
    addBunker(nest.x, nest.z, faceTo(nest, P(0.16)), 'nest');
    sandbagWall(ringOf(nest.x, nest.z, 8.5, 0.4, 3.6, 8), 2.4);

    const dug = P(0.245, 54);
    L.tanks.push({ x: dug.x, z: dug.z, yaw: faceTo(dug, P(0.19)), kind: 'dugin' });
    addMound(dug.x, dug.z, 26, 4.5);

    // wrecked convoy strewn over the carriageway
    for (let i = 0; i < 5; i++) {
      const p = P(0.185 + i * 0.008, i % 2 ? 6.5 : -6.0);
      addProp('truckWreck', p.x, p.z, p.yaw + rng.range(-0.7, 0.7));
    }
    hedgehogLine(P(0.235, 16).x, P(0.235, 16).z, P(0.235, 7).x, P(0.235, 7).z, 3, 1.5);
    hedgehogLine(P(0.245, -16).x, P(0.245, -16).z, P(0.245, -7).x, P(0.245, -7).z, 3, 1.5);
    roadMines(0.255, 'tank', [-4, 4.5]);
    roadMines(0.262, 'tank', [0.5]);
    L.signs.push({ x: P(0.25, 12).x, z: P(0.25, 12).z, yaw: 0, kind: 'mine' });
    for (const run of crossBelt(P(0.235).z - 20, { step: 11, pad: 12, from: -300, to: 300 })) {
      L.wire.push({ points: run, kind: 'concertina' });
    }
  }

  // =========================================================================
  // SECTOR 3 - the hairpin under the ridge (t 0.29 - 0.42)
  // =========================================================================
  {
    const apex = P(0.325);
    addMound(apex.x + 70, apex.z - 30, 78, 17);
    addMound(apex.x - 40, apex.z + 70, 54, 9);

    const hi = P(0.33, -84);
    const hi2 = P(0.36, -70);
    addBunker(hi.x, hi.z, faceTo(hi, apex), 'casemate');
    addBunker(hi2.x, hi2.z, faceTo(hi2, P(0.30)), 'mg', { dug: true });
    sandbagWall(ringOf(hi2.x, hi2.z, 10, 2.0, 5.2, 9), 2.8);

    // communication trench from the casemate back over the crest
    L.trenches.push({
      points: [
        { x: hi.x - 6, z: hi.z + 6 }, { x: hi.x - 26, z: hi.z - 4 }, { x: hi.x - 34, z: hi.z - 22 },
        { x: hi2.x - 18, z: hi2.z + 10 }, { x: hi2.x - 4, z: hi2.z + 2 },
      ],
      width: 11, depth: 4.0, revetted: true,
    });

    for (const run of crossBelt(P(0.30).z, { step: 12, pad: 14, from: -320, to: 260 })) {
      L.wire.push({ points: run, kind: 'concertina' });
    }
    for (const run of crossBelt(P(0.39).z, { step: 12, pad: 14, from: -280, to: 320 })) {
      L.wire.push({ points: run, kind: 'low' });
    }
    // Outside of the hairpin is soft and mined - cutting the corner hurts.
    mineField(P(0.345, -30).x, P(0.345, -30).z, 46, 20, 'ap');
    mineField(P(0.30, 40).x, P(0.30, 40).z, 50, 8, 'tank');
    roadMines(0.375, 'tank', [-5, 3]);
    for (let i = 0; i < 6; i++) {
      const p = P(0.40 + i * 0.004, i % 2 ? 5.5 : -5.5);
      L.barricades.push({ x: p.x, z: p.z, yaw: p.yaw + (i % 2 ? 0.4 : -0.4), kind: i % 2 ? 'log' : 'concrete', len: 8 });
    }
  }

  // =========================================================================
  // SECTOR 4 - bypass junction: shorter, but it runs through a minefield
  // =========================================================================
  {
    const bypass = roads.paths.find((p) => p.name === 'bypass');
    const j = P(0.02, 0, bypass);
    L.signs.push({ x: j.x + 12, z: j.z + 4, yaw: -0.5, kind: 'mine' });
    mineField(P(0.35, 0, bypass).x, P(0.35, 0, bypass).z, 90, 40, 'ap', { onRoad: true, roadClear: -2 });
    roadMines(0.42, 'tank', [-3, 3.5], bypass);
    roadMines(0.55, 'tank', [0], bypass);
    for (const run of crossBelt(P(0.62, 0, bypass).z, { from: 170, to: 330, step: 10, pad: 6 })) {
      L.wire.push({ points: run, kind: 'concertina' });
    }
    const flank = P(0.5, -46, bypass);
    addBunker(flank.x, flank.z, faceTo(flank, P(0.35, 0, bypass)), 'mg');
    addMound(flank.x, flank.z, 34, 7);
  }

  // =========================================================================
  // SECTOR 5 - the tank park (t 0.47 - 0.60)
  // =========================================================================
  {
    const park = P(0.53, 92);
    for (let i = 0; i < 6; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = park.x + col * 34 - 34 + rng.range(-3, 3);
      const z = park.z + row * 38 - 19 + rng.range(-3, 3);
      L.tanks.push({ x, z, yaw: faceTo({ x, z }, P(0.5)) + rng.range(-0.25, 0.25), kind: i % 2 ? 'panzer' : 'sherman' });
      // earth revetment: a low U-shaped berm, not a hill to bury it in
      addMound(x - 7.5, z - 2, 8.5, 2.6);
      addMound(x + 7.5, z - 2, 8.5, 2.6);
      addMound(x, z - 8.5, 8.5, 2.3);
      addProp('barrel', x + rng.range(-16, 16), z + rng.range(-16, 16));
    }
    sandbagWall([
      { x: park.x - 60, z: park.z + 32 }, { x: park.x - 20, z: park.z + 38 },
      { x: park.x + 30, z: park.z + 34 }, { x: park.x + 62, z: park.z + 20 },
    ], 3.2);
    for (let i = 0; i < 10; i++) addProp('crate', park.x + rng.range(-70, 70), park.z + rng.range(-50, 50));
    for (let i = 0; i < 6; i++) addProp('barrel', park.x + rng.range(-70, 70), park.z + rng.range(-50, 50));

    const guard = P(0.5, 52);
    addBunker(guard.x, guard.z, faceTo(guard, P(0.46)), 'mg', { dug: true });
    const guard2 = P(0.58, -58);
    addBunker(guard2.x, guard2.z, faceTo(guard2, P(0.54)), 'nest');
    addMound(guard2.x, guard2.z, 30, 6);

    roadMines(0.565, 'tank', [-4.5, 4.5]);
    for (const run of crossBelt(P(0.56).z, { step: 12, pad: 13, from: -320, to: 60 })) {
      L.wire.push({ points: run, kind: 'concertina' });
    }
  }

  // =========================================================================
  // SECTOR 6 - second ridge: casemates, dragon's teeth, trench network
  // =========================================================================
  {
    const ridgeZ = P(0.66).z;
    addMound(-120, ridgeZ - 40, 110, 16);
    addMound(140, ridgeZ - 20, 96, 14);

    for (const run of crossBelt(ridgeZ, { step: 14, pad: 16, from: -330, to: 330, shape: (x) => (Math.floor(x / 28) % 2 ? 9 : -9) })) {
      L.trenches.push({ points: run, width: 13.5, depth: 4.6, revetted: true });
    }
    // dragon's teeth: two staggered rows, the only gap is the road
    for (const run of crossBelt(ridgeZ + 34, { step: 7.5, pad: 12, from: -300, to: 300 })) {
      for (const p of run) L.dragonTeeth.push({ x: p.x, z: p.z, yaw: rng.range(0, 1.6), scale: rng.range(0.9, 1.15) });
    }
    for (const run of crossBelt(ridgeZ + 42, { step: 7.5, pad: 12, from: -296, to: 304 })) {
      for (const p of run) L.dragonTeeth.push({ x: p.x, z: p.z, yaw: rng.range(0, 1.6), scale: rng.range(0.9, 1.15) });
    }

    const cA = P(0.655, 74);
    const cB = P(0.685, -80);
    addBunker(cA.x, cA.z, faceTo(cA, P(0.62)), 'casemate');
    addBunker(cB.x, cB.z, faceTo(cB, P(0.64)), 'casemate');
    sandbagWall(ringOf(cA.x, cA.z, 13, -0.4, 2.8, 10), 2.8);

    const spur = roads.paths.find((p) => p.name === 'spurA');
    const battery = P(1.0, 0, spur);
    addMound(battery.x, battery.z, 58, 11);
    addBunker(battery.x, battery.z, faceTo(battery, P(0.62)), 'casemate');
    addBunker(battery.x + 30, battery.z + 16, faceTo({ x: battery.x + 30, z: battery.z + 16 }, P(0.60)), 'mg', { dug: true });
    for (let i = 0; i < 8; i++) addProp('crate', battery.x + rng.range(-40, 40), battery.z + rng.range(-30, 30));

    mineField(P(0.70, -60).x, P(0.70, -60).z, 60, 26, 'ap');
    mineField(P(0.63, 70).x, P(0.63, 70).z, 55, 10, 'tank');
    roadMines(0.70, 'tank', [-4, 4]);
    for (let i = 0; i < 12; i++) {
      addCrater(rng.range(-260, 260), ridgeZ + rng.range(-90, 60), rng.range(9, 16), rng.range(2, 4.2));
    }
  }

  // =========================================================================
  // SECTOR 7 - the killing ground (t 0.78 - 0.92)
  // =========================================================================
  {
    const kg = P(0.85);
    for (let i = 0; i < 34; i++) {
      addCrater(rng.range(-300, 300), kg.z + rng.range(-180, 190), rng.range(9, 19), rng.range(2.2, 5.2));
    }
    for (const lat of [128, -132, 176, -186]) {
      const t = 0.80 + Math.abs(lat) * 0.00035;
      const b = P(t, lat);
      addBunker(b.x, b.z, faceTo(b, P(t - 0.05)), lat > 0 ? 'mg' : 'nest', { dug: true });
      addMound(b.x, b.z, 30, 6.5);
      sandbagWall(ringOf(b.x, b.z, 9.5, 0, 3.2, 8), 2.5);
    }
    for (const run of crossBelt(P(0.83).z, { step: 11, pad: 13, from: -330, to: 330 })) {
      L.wire.push({ points: run, kind: 'concertina' });
    }
    for (const run of crossBelt(P(0.87).z, { step: 11, pad: 13, from: -330, to: 330 })) {
      L.wire.push({ points: run, kind: 'low' });
    }
    mineField(kg.x - 150, kg.z, 80, 34, 'ap');
    mineField(kg.x + 160, kg.z - 40, 80, 30, 'ap');
    mineField(kg.x + 20, kg.z - 90, 70, 12, 'tank');
    roadMines(0.865, 'tank', [-5, 2]);
    roadMines(0.885, 'ap', [-2, 3, 6]);
    for (let i = 0; i < 5; i++) {
      const p = P(0.90 + i * 0.005, i % 2 ? 5 : -5);
      L.barricades.push({ x: p.x, z: p.z, yaw: p.yaw + (i % 2 ? 0.45 : -0.45), kind: 'concrete', len: 9 });
    }
    L.tanks.push(
      { x: P(0.82, 40).x, z: P(0.82, 40).z, yaw: 2.2, kind: 'wreck' },
      { x: P(0.88, -44).x, z: P(0.88, -44).z, yaw: 0.6, kind: 'dugin' },
    );
  }

  // =========================================================================
  // SECTOR 8 - THE WALL
  // =========================================================================
  {
    const wallZ = COURSE.wallZ;
    L.wall = {
      z: wallZ,
      gateX: 0,
      gateWidth: 30,
      height: 44,
      halfWidth: 430,
      towers: [-360, -260, -170, -92, 92, 170, 260, 360],
      casemates: [-58, 58],
    };
    // glacis: bare, mined, wired, swept by everything on the wall
    for (const lat of L.wall.towers) {
      L.bunkers.push({ x: lat * 0.98, z: wallZ + 16, yaw: 0, kind: 'wallmg', onWall: true, height: 30 });
    }
    for (const lat of L.wall.casemates) {
      const x = lat * 1.9;
      L.bunkers.push({ x, z: wallZ + 34, yaw: Math.atan2(-x * 0.2, 1) * 0.2, kind: 'casemate' });
      addMound(x, wallZ + 34, 30, 5);
    }
    for (const run of crossBelt(wallZ + 74, { step: 7.5, pad: 17, from: -320, to: 320 })) {
      for (const p of run) L.dragonTeeth.push({ x: p.x, z: p.z, yaw: rng.range(0, 1.6), scale: 1.1 });
    }
    for (const run of crossBelt(wallZ + 84, { step: 7.5, pad: 17, from: -316, to: 324 })) {
      for (const p of run) L.dragonTeeth.push({ x: p.x, z: p.z, yaw: rng.range(0, 1.6), scale: 1.1 });
    }
    for (const run of crossBelt(wallZ + 104, { step: 11, pad: 17, from: -330, to: 330 })) {
      L.wire.push({ points: run, kind: 'concertina' });
    }
    for (const run of crossBelt(wallZ + 120, { step: 14, pad: 18, from: -300, to: 300, shape: (x) => (Math.floor(x / 26) % 2 ? 7 : -7) })) {
      L.trenches.push({ points: run, width: 12.5, depth: 4.4, revetted: true });
    }
    hedgehogLine(-70, wallZ + 56, -24, wallZ + 52, 4, 2);
    hedgehogLine(24, wallZ + 52, 70, wallZ + 56, 4, 2);
    mineField(-150, wallZ + 96, 70, 26, 'ap');
    mineField(150, wallZ + 96, 70, 26, 'ap');
    roadMines(0.965, 'tank', [-4, 4]);
    for (let i = 0; i < 16; i++) addCrater(rng.range(-280, 280), wallZ + rng.range(50, 170), rng.range(9, 15), rng.range(2, 4));
    L.tanks.push(
      { x: -96, z: wallZ + 62, yaw: 0.1, kind: 'dugin' },
      { x: 104, z: wallZ + 58, yaw: -0.1, kind: 'dugin' },
    );
    const spurB = roads.paths.find((p) => p.name === 'spurB');
    for (let i = 0; i < 4; i++) {
      const p = P(0.3 + i * 0.15, 20, spurB);
      L.tanks.push({ x: p.x, z: p.z, yaw: p.yaw + 1.5, kind: i % 2 ? 'sherman' : 'panzer' });
    }
  }

  // --- global scatter ------------------------------------------------------
  for (let i = 0; i < 90; i++) {
    const x = rng.range(-340, 340);
    const z = rng.range(-2650, 60);
    const hit = roads.nearest(x, z, 26);
    if (hit && hit.dist < hit.sample.width * 0.5 + 6) continue;
    addProp(rng.pick(['deadTree', 'rubble', 'rubble', 'post', 'crate']), x, z);
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-330, 330);
    const z = rng.range(-2600, 0);
    addCrater(x, z, rng.range(9, 15), rng.range(1.6, 3.4));
  }
  // --- field repair dumps ---------------------------------------------------
  // Five engineer dumps spaced along the route, set just off the carriageway so
  // grabbing one costs you a little time and a little line.
  [0.16, 0.33, 0.49, 0.64, 0.79, 0.91].forEach((t, i) => {
    const lat = (i % 2 ? 1 : -1) * 11.5;
    const p = P(t, lat);
    L.depots.push({ x: p.x, z: p.z, yaw: p.yaw + Math.PI / 2 });
  });

  // telegraph poles follow the road - a readable navigation aid on a long course
  for (let t = 0.06; t < 0.99; t += 0.012) {
    const p = P(t, t % 0.024 < 0.012 ? 13 : -13);
    addProp('telegraph', p.x, p.z, p.yaw);
  }

  return L;
}
