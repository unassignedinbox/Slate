// Procedural city generation (NFS-scale): hierarchical street grid with
// alleys, an elevated expressway with curved ramps over Central Boulevard,
// a roundabout, river with typed bridges (cable-stayed, arch, truss…),
// mainline with level crossings, metro line, parks with pathway loops,
// and proper parking lots + a parking deck.
import { makeRng, uid } from './util.js';
import { PROFILES, profileWidth } from './profiles.js';

const S = 96; // road-to-road spacing

export function generateCity(doc, params = {}) {
  const {
    seed = 42,
    blocks = 8,
    rail = true,
    subway = true,
    river = true,
    expressway = true,
    roundabout = true,
    busNetwork = true,
    bikeNetwork = true,
    parking = true,
    furniture = true,
    speedBumps = true,
  } = params;

  const rng = makeRng(seed);
  const k = Math.max(2, Math.floor(blocks / 2));
  doc.clear();
  doc.sceneName = `City · seed ${seed}`;
  doc.env = { river: null, parks: [] };

  const linePos = (i) => i * S;
  const snap = (v) => Math.round(v * 100) / 100;

  const profileForLine = (idx) => {
    if (idx === 0) return busNetwork ? 'boulevard' : 'avenue';
    if (Math.abs(idx) === 1) return parking ? 'avenue' : 'street';
    if (Math.abs(idx) === 2) return 'street';
    return 'local';
  };

  const railX = linePos(k) + S * 0.55;
  const railZ0 = linePos(-k) - S * 0.85;
  const railZ1 = linePos(k) + S * 0.85;
  const riverZ = linePos(-k) + S * 0.62;
  const riverHalf = 17;
  const riverXExtent = linePos(k) + S * 0.3;

  function addRoadSegment(name, profileKey, points, extra = {}) {
    const seg = {
      id: uid('rd'),
      name,
      profile: profileKey,
      points: points.map((p) => ({ x: snap(p.x), y: snap(p.y ?? 0), z: snap(p.z) })),
      junctions: extra.junctions || { start: true, end: true },
      bridge: !!extra.bridge,
      bridgeType: extra.bridgeType,
      bridgeAbutments: extra.bridgeAbutments,
      overrides: extra.overrides || {},
    };
    doc.segments.push(seg);
    return seg;
  }

  // =================== 1. street grid ===================
  const nsIdxs = [];
  const ewIdxs = [];
  for (let i = -k; i <= k; i++) {
    nsIdxs.push(i);
    ewIdxs.push(i);
  }

  const RA = roundabout ? 25.5 : 0; // roundabout connection radius

  for (const i of nsIdxs) {
    const x = linePos(i);
    const profileKey = profileForLine(i);
    const width = profileWidth(PROFILES[profileKey]);
    const crossingRiver = river && Math.abs(x) < riverXExtent - riverHalf;

    for (let j = -k; j < k; j++) {
      let z0 = linePos(j) + width * 0.28;
      let z1 = linePos(j + 1) - width * 0.28;
      // trim for the roundabout arms
      if (i === 0 && RA) {
        if (j === -1) z1 = -RA;
        if (j === 0) z0 = RA;
      }
      const name = `${PROFILES[profileKey].name} · ${i === 0 ? 'Central' : `NS ${i}`} / ${j + k + 1}`;
      const inRiverBand = crossingRiver && z0 < riverZ - riverHalf && z1 > riverZ + riverHalf;

      if (inRiverBand) {
        const btype = i === 0 ? 'cable' : Math.abs(i) === 1 ? 'arch' : Math.abs(i) % 2 === 0 ? 'truss' : 'girder';
        addRoadSegment(`${name} · ${btype} bridge`, profileKey, [
          { x, z: z0, y: 0 },
          { x, z: riverZ - riverHalf - 26, y: 0.25 },
          { x, z: riverZ - riverHalf - 3, y: 3.5 },
          { x, z: riverZ + riverHalf + 3, y: 3.5 },
          { x, z: riverZ + riverHalf + 26, y: 0.25 },
          { x, z: z1, y: 0 },
        ], { bridge: true, bridgeType: btype });
      } else {
        addRoadSegment(name, profileKey, [
          { x, z: z0, y: 0 },
          { x, z: (z0 + z1) / 2, y: 0 },
          { x, z: z1, y: 0 },
        ]);
      }
    }
  }

  for (const j of ewIdxs) {
    const z = linePos(j);
    const profileKey = profileForLine(j);
    const width = profileWidth(PROFILES[profileKey]);

    for (let i = -k; i < k; i++) {
      let x0 = linePos(i) + width * 0.28;
      let x1 = linePos(i + 1) - width * 0.28;
      if (j === 0 && RA) {
        if (i === -1) x1 = -RA;
        if (i === 0) x0 = RA;
      }
      const name = `${PROFILES[profileKey].name} · ${j === 0 ? 'Main Ave' : `EW ${j}`} / ${i + k + 1}`;
      addRoadSegment(name, profileKey, [
        { x: x0, z, y: 0 },
        { x: (x0 + x1) / 2, z, y: 0 },
        { x: x1, z, y: 0 },
      ]);
    }
  }

  // =================== 2. mid-block alleys ===================
  for (const i of nsIdxs) {
    if (i >= k) continue;
    for (const j of ewIdxs) {
      if (j >= k) continue;
      if ((i + j) % 2 !== 0) continue;
      const cx = linePos(i) + S / 2;
      const cz = linePos(j) + S / 2;
      const horiz = Math.abs(i) % 2 === 0;
      if (horiz) {
        addRoadSegment(`Service alley · ${i},${j}`, 'alley', [
          { x: linePos(i) + 12, z: cz, y: 0 },
          { x: linePos(i + 1) - 12, z: cz, y: 0 },
        ], { junctions: { start: false, end: false } });
      } else {
        addRoadSegment(`Service alley · ${i},${j}`, 'alley', [
          { x: cx, z: linePos(j) + 12, y: 0 },
          { x: cx, z: linePos(j + 1) - 12, y: 0 },
        ], { junctions: { start: false, end: false } });
      }
    }
  }

  // =================== 3. roundabout ===================
  if (roundabout) {
    const r = 24.2;
    for (let q = 0; q < 4; q++) {
      const a0 = (q * Math.PI) / 2 + 0.13;
      const a1 = ((q + 1) * Math.PI) / 2 - 0.13;
      const pts = [];
      for (let t = 0; t <= 6; t++) {
        const a = a0 + (a1 - a0) * (t / 6);
        pts.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r });
      }
      addRoadSegment(`Roundabout arc ${q + 1}`, 'street', pts, {
        junctions: { start: false, end: false },
      });
    }
    doc.env.parks.push({
      id: uid('pk'),
      name: 'Roundabout island',
      kind: 'roundabout',
      shape: 'circle',
      x: 0,
      z: 0,
      w: 34,
      h: 34,
    });
    // island trees
    for (let t = 0; t < 5; t++) {
      const a = (t / 5) * Math.PI * 2;
      doc.props.push({
        id: uid('pr'),
        kind: 'tree',
        name: 'Island tree',
        x: Math.cos(a) * 6.5,
        y: 0.12,
        z: Math.sin(a) * 6.5,
        rotY: a,
        opts: { scale: 1.15 },
      });
    }
  }

  // =================== 4. junction pads ===================
  const junctions = [];
  for (const i of nsIdxs) {
    for (const j of ewIdxs) {
      if (roundabout && i === 0 && j === 0) continue;
      const a = PROFILES[profileForLine(i)];
      const b = PROFILES[profileForLine(j)];
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

  // =================== 5. railway + level crossings ===================
  if (rail) {
    const railPoints = [];
    for (let z = railZ0; z <= railZ1; z += 40) {
      const bend = Math.sin(((z - railZ0) / (railZ1 - railZ0)) * Math.PI * 1.35) * S * 0.16;
      railPoints.push({ x: railX + bend, z, y: 0 });
    }
    const line = {
      id: uid('rl'),
      name: 'North–South mainline',
      points: railPoints,
      crossings: [],
    };
    for (const zCross of [linePos(-1), linePos(1)]) {
      let idx = railPoints.findIndex((p) => p.z >= zCross);
      if (idx <= 0) idx = 1;
      const a = railPoints[idx - 1];
      const b = railPoints[idx];
      const t = (zCross - a.z) / Math.max(1e-6, b.z - a.z);
      line.crossings.push({ s: (idx - 1) * 40 + t * 40, roadDirX: 1, roadDirZ: 0 });
    }
    doc.rails.push(line);

    // station approach streets extending east across the mainline
    for (const j of [-1, 1]) {
      const z = linePos(j);
      addRoadSegment(`Station approach · level crossing ${j > 0 ? 'N' : 'S'}`, 'street', [
        { x: linePos(k) - S * 0.2, z, y: 0 },
        { x: railX, z, y: 0.06 },
        { x: railX + S * 0.55, z, y: 0 },
      ], { junctions: { start: true, end: false } });
    }
  }

  // =================== 6. river + quays ===================
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

  // =================== 7. elevated expressway + ramps ===================
  if (expressway) {
    const ey = 9.2;
    for (let j = -k; j < k; j++) {
      const z0 = linePos(j) + 14;
      const z1 = linePos(j + 1) - 14;
      addRoadSegment(`Expressway E1 · span ${j + k + 1}`, 'motorway', [
        { x: 0, z: z0, y: ey },
        { x: 0, z: (z0 + z1) / 2, y: ey },
        { x: 0, z: z1, y: ey },
      ], {
        junctions: { start: false, end: false },
        bridge: true,
        bridgeType: 'girder',
        bridgeAbutments: false,
      });
    }
    // curved ramps down to the avenues at z = +-S
    for (const zc of [-S, S]) {
      for (const side of [-1, 1]) {
        const dir = Math.sign(zc) || 1;
        const pts = [
          { x: 0, z: zc - dir * 52, y: ey },
          { x: side * 16, z: zc - dir * 34, y: ey * 0.78 },
          { x: side * 36, z: zc - dir * 16, y: ey * 0.42 },
          { x: side * 54, z: zc - dir * 4, y: ey * 0.13 },
          { x: side * 64, z: zc + dir * 12, y: 0 },
        ];
        addRoadSegment(`Expressway ramp · ${side > 0 ? 'E' : 'W'} ${zc > 0 ? 'N' : 'S'}`, 'highwayRamp', pts, {
          junctions: { start: false, end: false },
          bridge: true,
          bridgeType: 'girder',
          bridgeAbutments: false,
        });
      }
    }
  }

  // =================== 8. subway ===================
  if (subway) {
    const stations = [
      { x: linePos(0) - 12, z: linePos(-1), angle: 0, name: 'West Market station' },
      { x: linePos(0) - 12, z: linePos(1), angle: 0, name: 'Civic Square station' },
    ];
    doc.subways.push({
      id: uid('sw'),
      name: 'Line M1 · North-south',
      depth: -9,
      points: [
        { x: linePos(0) - 12, z: linePos(-k) - 20, y: 0 },
        { x: linePos(0) - 12, z: 0, y: 0 },
        { x: linePos(0) - 12, z: linePos(k) + 20, y: 0 },
      ],
      stations,
    });
  }

  // =================== 9. parks + pathway loops ===================
  const parkCandidates = [
    { i: -2, j: 2, name: 'Foundry Park' },
    { i: 2, j: -2, name: 'Harbour Green' },
    { i: -1, j: -2, name: 'Willow Square' },
    { i: 2, j: 2, name: 'Orchard Common' },
    { i: -3, j: 1, name: 'Foundry Green' },
  ];
  for (const pc of parkCandidates.slice(0, blocks >= 7 ? 5 : 3)) {
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
    addRoadSegment(`${pc.name} path · E–W`, 'pathway', [
      { x: x - S * 0.3, z, y: 0.02 },
      { x: x + S * 0.3, z, y: 0.02 },
    ], { junctions: { start: false, end: false } });
    addRoadSegment(`${pc.name} path · N–S`, 'pathway', [
      { x, z: z - S * 0.3, y: 0.02 },
      { x, z: z + S * 0.3, y: 0.02 },
    ], { junctions: { start: false, end: false } });
    addRoadSegment(`${pc.name} diagonal walk`, 'pathway', [
      { x: x - S * 0.26, z: z - S * 0.26, y: 0.02 },
      { x: x + S * 0.26, z: z + S * 0.26, y: 0.02 },
    ], { junctions: { start: false, end: false } });
    // circular fitness loop
    const loop = [];
    for (let t = 0; t <= 12; t++) {
      const a = (t / 12) * Math.PI * 2;
      loop.push({ x: x + Math.cos(a) * S * 0.22, y: 0.02, z: z + Math.sin(a) * S * 0.22 });
    }
    addRoadSegment(`${pc.name} loop trail`, 'pathway', loop, {
      junctions: { start: false, end: false },
    });
  }

  // =================== 10. parking ===================
  if (parking) {
    const lots = [
      { x: linePos(-2) + S / 2, z: linePos(2) + S / 2, w: 62, h: 40, angle: 90, name: 'Foundry Park car park' },
      { x: linePos(2) + S / 2, z: linePos(-2) + S / 2, w: 58, h: 38, angle: 60, name: 'Harbour Green car park' },
      { x: linePos(-2) + S / 2, z: linePos(-1) + S / 2, w: 56, h: 36, angle: 90, name: 'Willow Square car park' },
      { x: linePos(1) + S / 2, z: linePos(2) + S / 2, w: 60, h: 40, angle: 90, name: 'Orchard car park' },
    ];
    if (rail) {
      lots.push({ x: railX - 78, z: linePos(1) + S * 0.42, w: 84, h: 50, angle: 90, name: 'Station P+R' });
    }
    for (const l of lots) {
      doc.parkingLots.push({
        id: uid('pk'),
        kind: 'lot',
        rotY: 0,
        ...l,
      });
    }
    // multi-storey deck near the station
    doc.parkingLots.push({
      id: uid('pk'),
      kind: 'deck',
      name: 'Central parking deck',
      x: linePos(2) + S / 2,
      z: linePos(1) + S / 2,
      w: 58,
      h: 40,
      levels: 3,
      rotY: 0,
    });
  }

  // =================== 11. furniture ===================
  if (furniture) {
    seedFurniture(doc, rng, { speedBumps, k, linePos });
  }

  doc.emit('structure');
  return doc;
}

function seedFurniture(doc, rng, o) {
  const placeAlong = (seg, side, every, kind, opts = {}) => {
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
    const isLocal = seg.profile === 'local' || seg.profile === 'alley';
    const isBig = seg.profile === 'boulevard' || seg.profile === 'avenue';
    const isHighway = seg.profile === 'motorway' || seg.profile === 'highwayRamp';

    if (!isPath && !isHighway) {
      placeAlong(seg, 1, 32, 'streetlight');
      placeAlong(seg, -1, 32, 'streetlight');
    } else if (isHighway) {
      placeAlong(seg, 1, 48, 'streetlight', { inset: 1.8 });
      placeAlong(seg, -1, 48, 'streetlight', { inset: 1.8 });
    }
    if (isBig) {
      placeAlong(seg, 1, 26, 'tree', { inset: 2.1, dy: 0.15 });
      placeAlong(seg, -1, 26, 'tree', { inset: 2.1, dy: 0.15 });
      placeAlong(seg, 1, 64, 'trash', { inset: 1.5 });
      placeAlong(seg, -1, 64, 'trash', { inset: 1.5 });
      placeAlong(seg, 1, 70, 'bench', { inset: 1.7, dy: 0.15 });
      placeAlong(seg, -1, 70, 'bench', { inset: 1.7, dy: 0.15 });
    }
    if (isLocal && o.speedBumps && rng.chance(0.8)) {
      placeAlong(seg, 1, 46, 'speed-bump', { inset: 2.2, dy: 0.02 });
      placeAlong(seg, -1, 46, 'speed-bump', { inset: 2.2, dy: 0.02 });
    }
    if (isPath) {
      placeAlong(seg, 1, 36, 'bench', { inset: 1.7, dy: 0.02 });
      placeAlong(seg, -1, 43, 'bollard', { inset: 1.2, dy: 0.02 });
    }
    if (seg.profile === 'pedestrian') {
      placeAlong(seg, 1, 4.2, 'bollard', { inset: 1.35, dy: 0.02 });
      placeAlong(seg, -1, 4.2, 'bollard', { inset: 1.35, dy: 0.02 });
    }
    if (!isPath && !isHighway && rng.chance(0.45)) {
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
    if (park.kind === 'roundabout') continue;
    const n = park.shape === 'circle' ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const x = park.x + rng.range(-park.w * 0.42, park.w * 0.42);
      const z = park.z + rng.range(-park.h * 0.42, park.h * 0.42);
      if (Math.abs(x - park.x) < 3.2 || Math.abs(z - park.z) < 3.2) continue;
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

  // subway entrances
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
