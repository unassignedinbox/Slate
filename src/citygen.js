// Procedural city generation: hierarchical street grid, bus/cycle/parking
// lanes, river with bridges, railway with a level crossing, subway line,
// parks with pathways, and street furniture (lights, bollards, bumps).
import { makeRng, uid } from './util.js';
import { PROFILES, profileWidth } from './profiles.js';

const S = 96; // road-to-road spacing

export function generateCity(doc, params = {}) {
  const {
    seed = 42,
    blocks = 6,
    rail = true,
    subway = true,
    river = true,
    busNetwork = true,
    bikeNetwork = true,
    parking = true,
    furniture = true,
    speedBumps = true,
  } = params;

  const rng = makeRng(seed);
  const k = Math.max(2, Math.floor(blocks / 2)); // lines at -k..k
  doc.clear();
  doc.sceneName = `City · seed ${seed}`;
  doc.env = { river: null, parks: [] };

  const linePos = (i) => i * S;

  const profileForLine = (idx, axis) => {
    if (idx === 0) return busNetwork ? 'boulevard' : 'avenue';
    if (Math.abs(idx) === 1) return parking ? 'avenue' : 'street';
    if (Math.abs(idx) === 2) return 'street';
    return 'local';
  };

  const roads = { ns: new Map(), ew: new Map() }; // axis -> idx -> segments[]

  const railX = linePos(k) + S * 0.55;
  const railZ0 = linePos(-k) - S * 0.85;
  const railZ1 = linePos(k) + S * 0.85;
  const riverZ = linePos(-k) + S * 0.62; // between first two rows
  const riverHalf = 17;
  const riverXExtent = linePos(k) + S * 0.3; // river stops before the rail strip

  // ---------------- helpers ----------------
  const snap = (v) => Math.round(v * 100) / 100;

  function addRoadSegment(name, profileKey, points, extra = {}) {
    const seg = {
      id: uid('rd'),
      name,
      profile: profileKey,
      points: points.map((p) => ({ x: snap(p.x), y: snap(p.y ?? 0), z: snap(p.z) })),
      junctions: extra.junctions || { start: true, end: true },
      bridge: !!extra.bridge,
      overrides: extra.overrides || {},
    };
    doc.segments.push(seg);
    return seg;
  }

  // ---------------- grid lines ----------------
  const nsIdxs = [];
  const ewIdxs = [];
  for (let i = -k; i <= k; i++) {
    nsIdxs.push(i);
    ewIdxs.push(i);
  }

  // N-S roads (constant x = linePos(i)), from z=-kS..kS
  for (const i of nsIdxs) {
    const x = linePos(i);
    const profileKey = profileForLine(i, 'ns');
    const width = profileWidth(PROFILES[profileKey]);
    const crossingRiver = river && Math.abs(x) < riverXExtent - riverHalf;

    for (let j = -k; j < k; j++) {
      const z0 = linePos(j) + width * 0.28;
      const z1 = linePos(j + 1) - width * 0.28;
      const name = `${PROFILES[profileKey].name} · ${i === 0 ? 'Central' : `NS ${i}`} / block ${j + k + 1}`;
      const inRiverBand = crossingRiver && z0 < riverZ - riverHalf && z1 > riverZ + riverHalf;

      if (inRiverBand) {
        // hump bridge over the river
        addRoadSegment(`${name} (river bridge)`, profileKey, [
          { x, z: z0, y: 0 },
          { x, z: riverZ - riverHalf - 26, y: 0.25 },
          { x, z: riverZ - riverHalf - 3, y: 3.5 },
          { x, z: riverZ + riverHalf + 3, y: 3.5 },
          { x, z: riverZ + riverHalf + 26, y: 0.25 },
          { x, z: z1, y: 0 },
        ], { bridge: true });
      } else {
        addRoadSegment(name, profileKey, [
          { x, z: z0, y: 0 },
          { x, z: (z0 + z1) / 2, y: 0 },
          { x, z: z1, y: 0 },
        ]);
      }
      if (!roads.ns.has(i)) roads.ns.set(i, []);
      roads.ns.get(i).push(doc.segments[doc.segments.length - 1]);
    }
  }

  // E-W roads (constant z = linePos(j))
  for (const j of ewIdxs) {
    const z = linePos(j);
    const profileKey = profileForLine(j, 'ew');
    const width = profileWidth(PROFILES[profileKey]);

    for (let i = -k; i < k; i++) {
      const x0 = linePos(i) + width * 0.28;
      const x1 = linePos(i + 1) - width * 0.28;
      const name = `${PROFILES[profileKey].name} · ${j === 0 ? 'Main Ave' : `EW ${j}`} / block ${i + k + 1}`;
      addRoadSegment(name, profileKey, [
        { x: x0, z, y: 0 },
        { x: (x0 + x1) / 2, z, y: 0 },
        { x: x1, z, y: 0 },
      ]);
      if (!roads.ew.has(j)) roads.ew.set(j, []);
      roads.ew.get(j).push(doc.segments[doc.segments.length - 1]);
    }
  }

  // East connector street with the railway level crossing
  if (rail) {
    const j = 1;
    const z = linePos(j);
    const profileKey = 'street';
    const name = 'Station approach · level crossing';
    addRoadSegment(name, profileKey, [
      { x: linePos(k) - S * 0.2, z, y: 0 },
      { x: railX, z, y: 0.06 },
      { x: railX + S * 0.62, z, y: 0 },
    ], { junctions: { start: true, end: false } });
  }

  // ---------------- junctions (pads) ----------------
  const junctions = [];
  for (const i of nsIdxs) {
    for (const j of ewIdxs) {
      const a = PROFILES[profileForLine(i, 'ns')];
      const b = PROFILES[profileForLine(j, 'ew')];
      const size = Math.max(profileWidth(a), profileWidth(b)) * 0.52;
      junctions.push({ x: linePos(i), z: linePos(j), size, i, j });
    }
  }
  doc.junctions = junctions.map((j) => ({
    id: uid('jn'),
    name: `Junction ${j.i},${j.j}`,
    x: j.x,
    z: j.z,
    size: j.size,
    kind: 'junction',
  }));

  // ---------------- railway ----------------
  if (rail) {
    const railPoints = [];
    for (let z = railZ0; z <= railZ1; z += 40) {
      // gentle S-curve
      const bend = Math.sin(((z - railZ0) / (railZ1 - railZ0)) * Math.PI * 1.35) * S * 0.16;
      railPoints.push({ x: railX + bend, z, y: 0 });
    }
    const line = {
      id: uid('rl'),
      name: 'North–South mainline',
      points: railPoints,
      crossings: [],
    };
    // place the level crossing at the station approach (z = S)
    const zCross = linePos(1);
    let idx = railPoints.findIndex((p) => p.z >= zCross);
    if (idx <= 0) idx = 1;
    const a = railPoints[idx - 1];
    const b = railPoints[idx];
    const t = (zCross - a.z) / Math.max(1e-6, b.z - a.z);
    line.crossings.push({
      s: (idx - 1) * 40 + t * 40,
      roadDirX: 1,
      roadDirZ: 0,
    });
    doc.rails.push(line);
  }

  // ---------------- river + banks ----------------
  if (river) {
    doc.env.river = {
      id: uid('rv'),
      name: 'River',
      kind: 'river',
      x: 0,
      z: riverZ,
      half: riverHalf,
      length: riverXExtent * 2,
    };
    // waterfront promenades
    for (const side of [-1, 1]) {
      addRoadSegment(
        side < 0 ? 'North quay promenade' : 'South quay promenade',
        'waterfront',
        [
          { x: -riverXExtent, z: riverZ + side * (riverHalf + 10), y: 0 },
          { x: 0, z: riverZ + side * (riverHalf + 12), y: 0 },
          { x: riverXExtent, z: riverZ + side * (riverHalf + 10), y: 0 },
        ],
        { junctions: { start: false, end: false } }
      );
    }
  }

  // ---------------- subway ----------------
  if (subway) {
    const stations = [
      { x: linePos(0) - 10, z: linePos(-1), angle: 0, name: 'West Market station' },
      { x: linePos(0) - 10, z: linePos(1), angle: 0, name: 'Civic Square station' },
    ];
    doc.subways.push({
      id: uid('sw'),
      name: 'Line M1 · North-south',
      depth: -9,
      points: [
        { x: linePos(0) - 10, z: linePos(-k) - 20, y: 0 },
        { x: linePos(0) - 10, z: 0, y: 0 },
        { x: linePos(0) - 10, z: linePos(k) + 20, y: 0 },
      ],
      stations,
    });
  }

  // ---------------- parks ----------------
  const parkCandidates = [
    { i: -2, j: 2, name: 'Foundry Park' },
    { i: 2, j: -2, name: 'Harbour Green' },
    { i: -1, j: -2, name: 'Willow Square' },
  ];
  for (const pc of parkCandidates.slice(0, blocks >= 5 ? 3 : 2)) {
    const x = linePos(pc.i) + S / 2;
    const z = linePos(pc.j) + S / 2;
    doc.env.parks.push({
      id: uid('pk'),
      name: pc.name,
      kind: 'park',
      x,
      z,
      w: S * 0.62,
      h: S * 0.62,
    });
    // park pathways (cross)
    addRoadSegment(`${pc.name} path · E–W`, 'pathway', [
      { x: x - S * 0.3, z, y: 0.02 },
      { x: x + S * 0.3, z, y: 0.02 },
    ], { junctions: { start: false, end: false } });
    addRoadSegment(`${pc.name} path · N–S`, 'pathway', [
      { x, z: z - S * 0.3, y: 0.02 },
      { x, z: z + S * 0.3, y: 0.02 },
    ], { junctions: { start: false, end: false } });
    // diagonal
    addRoadSegment(`${pc.name} diagonal walk`, 'pathway', [
      { x: x - S * 0.26, z: z - S * 0.26, y: 0.02 },
      { x: x + S * 0.26, z: z + S * 0.26, y: 0.02 },
    ], { junctions: { start: false, end: false } });
  }

  // ---------------- furniture ----------------
  if (furniture) {
    seedFurniture(doc, rng, {
      speedBumps,
      river,
      riverZ,
      riverHalf,
      riverXExtent,
      railX,
      rail,
      k,
      linePos,
    });
  }

  doc.emit('structure');
  return doc;
}

function seedFurniture(doc, rng, o) {
  const { linePos, k, river, riverZ, riverHalf, riverXExtent, rail, railX } = o;

  const placeAlong = (seg, side, every, kind, opts = {}) => {
    // side: +1 right of travel, -1 left
    const pts = seg.points;
    let total = 0;
    const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      lens.push(d);
      total += d;
    }
    const profile = PROFILES[seg.profile];
    const half = profileWidth(profile) / 2;
    for (let s = every * 0.55; s < total - 2; s += every) {
      let acc = 0;
      let x = pts[0].x;
      let z = pts[0].z;
      let y = pts[0].y ?? 0;
      let dx = 1;
      let dz = 0;
      for (let i = 0; i < lens.length; i++) {
        if (acc + lens[i] >= s) {
          const t = (s - acc) / Math.max(lens[i], 0.001);
          x = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
          z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
          y = (pts[i].y ?? 0) + ((pts[i + 1].y ?? 0) - (pts[i].y ?? 0)) * t;
          dx = pts[i + 1].x - pts[i].x;
          dz = pts[i + 1].z - pts[i].z;
          break;
        }
        acc += lens[i];
      }
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const off = (half - (opts.inset ?? 1.15)) * side;
      doc.props.push({
        id: uid('pr'),
        kind,
        name: kind,
        x: x + nx * off,
        y: y + (opts.dy ?? 0.15),
        z: z + nz * off,
        rotY: Math.atan2(nx, nz) + (side > 0 ? 0 : Math.PI),
        opts: opts.opts || {},
      });
    }
  };

  for (const seg of doc.segments) {
    const isPath = seg.profile === 'pathway' || seg.profile === 'pedestrian';
    const isLocal = seg.profile === 'local';
    const isBig = seg.profile === 'boulevard' || seg.profile === 'avenue';

    if (!isPath) {
      placeAlong(seg, 1, 27, 'streetlight');
      placeAlong(seg, -1, 27, 'streetlight');
    }
    if (isBig) {
      placeAlong(seg, 1, 24, 'tree', { inset: 2.1, dy: 0.15 });
      placeAlong(seg, -1, 24, 'tree', { inset: 2.1, dy: 0.15 });
      placeAlong(seg, 1, 60, 'trash', { inset: 1.5 });
      placeAlong(seg, -1, 60, 'trash', { inset: 1.5 });
    }
    if (isLocal && o.speedBumps && rng.chance(0.8)) {
      placeAlong(seg, 1, 42, 'speed-bump', { inset: 2.2, dy: 0.02 });
      placeAlong(seg, -1, 42, 'speed-bump', { inset: 2.2, dy: 0.02 });
    }
    if (isPath) {
      placeAlong(seg, 1, 34, 'bench', { inset: 1.7, dy: 0.02 });
      placeAlong(seg, -1, 41, 'bollard', { inset: 1.2, dy: 0.02 });
    }
    if (seg.profile === 'pedestrian') {
      placeAlong(seg, 1, 4.2, 'bollard', { inset: 1.35, dy: 0.02 });
      placeAlong(seg, -1, 4.2, 'bollard', { inset: 1.35, dy: 0.02 });
    }
    // speed limit signs near segment starts
    if (!isPath && rng.chance(0.45)) {
      const pts = seg.points;
      const dx = pts[1].x - pts[0].x;
      const dz = pts[1].z - pts[0].z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const half = profileWidth(PROFILES[seg.profile]) / 2;
      doc.props.push({
        id: uid('pr'),
        kind: 'sign-speed',
        name: 'Speed limit sign',
        x: pts[0].x + nx * (half - 1),
        y: 0.15,
        z: pts[0].z + nz * (half - 1),
        rotY: Math.atan2(nx, nz) + Math.PI / 2,
        opts: { label: PROFILES[seg.profile].speedLimit },
      });
    }
  }

  // park furniture
  for (const park of doc.env.parks) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x = park.x + rng.range(-park.w * 0.42, park.w * 0.42);
      const z = park.z + rng.range(-park.h * 0.42, park.h * 0.42);
      if (Math.abs(x - park.x) < 3 || Math.abs(z - park.z) < 3) continue;
      doc.props.push({
        id: uid('pr'),
        kind: 'tree',
        name: 'Park tree',
        x,
        y: 0,
        z,
        rotY: rng.range(0, Math.PI * 2),
        opts: { scale: rng.range(0.9, 1.45) },
      });
    }
    for (const side of [-1, 1]) {
      doc.props.push({
        id: uid('pr'),
        kind: 'bench',
        name: 'Park bench',
        x: park.x + side * 5,
        y: 0,
        z: park.z + 6.5,
        rotY: Math.PI,
      });
      doc.props.push({
        id: uid('pr'),
        kind: 'trash',
        name: 'Park bin',
        x: park.x + side * 7.4,
        y: 0,
        z: park.z + 6.2,
        rotY: 0,
      });
    }
  }

  // subway entrances next to stations
  for (const st of doc.subways[0]?.stations || []) {
    for (const side of [-1, 1]) {
      doc.props.push({
        id: uid('pr'),
        kind: 'subway-entrance',
        name: `Entrance · ${st.name}`,
        x: st.x + side * 17,
        y: 0.15,
        z: st.z + 6,
        rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }
}
