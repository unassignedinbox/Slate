// Fills the town around the road. Deterministic: same layout + seeds -> same town.
//
// Generation rules (the road always wins):
//   - Ground-level road keeps T.clearance metres from any wall (streets have room to breathe).
//   - No road passes through a building. Road over a roof must sit on top of it (see roofBlocks).
//   - Streets never run over removed ground (holes), except as 'bridge' or 'roof'.
//   - Props and debris float around the streets, never on top of them.

import { Path } from '../../greybox/src/sim/path.js';
import { T } from '../../greybox/src/sim/tuning.js';
import { mulberry32 } from '../../greybox/src/sim/rng.js';

export const PLATE = 40;     // ground plate size (m); holes remove whole plates
const TAU = Math.PI * 2;

export function buildPaths(level) {
  return level.legs.map((def) => new Path(def));
}

const inRect = (x, z, r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
const normRect = ([x0, z0, x1, z1]) => [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)];

// Distance from point to axis-aligned box (0 if inside)
function rectDist(px, pz, b) {
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2;
  const z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const dx = Math.max(x0 - px, 0, px - x1);
  const dz = Math.max(z0 - pz, 0, pz - z1);
  return Math.hypot(dx, dz);
}

function boxesOverlap(a, b, gap) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap &&
    Math.abs(a.z - b.z) < (a.d + b.d) / 2 + gap
  );
}

// Returns list of human-readable conflicts for a candidate box against the road of this shard.
function roadConflicts(box, shardPaths, strict) {
  const out = [];
  for (const path of shardPaths) {
    const S = path.samples;
    for (let i = 0; i < S.length; i++) {
      const sm = S[i];
      if (!sm.exists) continue;
      const d = rectDist(sm.x, sm.z, box);
      const top = box.h + 0.2;
      if (d === 0 && sm.y < top) {
        out.push(`${path.id}: road through building at (${sm.x.toFixed(0)},${sm.z.toFixed(0)}) y=${sm.y.toFixed(1)} < roof ${box.h.toFixed(1)}`);
        if (!strict) return out;
      } else if (d < T.clearance && sm.y < top) {
        out.push(`${path.id}: wall within ${T.clearance} m of road at (${sm.x.toFixed(0)},${sm.z.toFixed(0)}) y=${sm.y.toFixed(1)}`);
        if (!strict) return out;
      }
    }
  }
  return out;
}

function onRemovedGround(sm, plates, S) {
  const ix = Math.floor((sm.x + S / 2) / PLATE);
  const iz = Math.floor((sm.z + S / 2) / PLATE);
  const row = plates[ix];
  return !row || row[iz] === false;
}

export function buildTown(level, paths) {
  const town = { shards: {} };
  const shardPaths = (id) => paths.filter((p, i) => level.legs[i].shard === id);

  for (const shard of level.shards) {
    const S = shard.size[0];
    const half = S / 2;
    const holes = shard.holes.map(normRect);
    const inHole = (x, z) => holes.some((h) => inRect(x, z, h));
    const bounds = [-half, -half, half, half];
    const paths_ = shardPaths(shard.id);

    // ---- plates: ground cells, missing where there is a hole
    const plates = [];
    const plateMap = [];
    const nCells = Math.round(S / PLATE);
    for (let ix = 0; ix < nCells; ix++) {
      plateMap[ix] = [];
      for (let iz = 0; iz < nCells; iz++) {
        const cx = -half + PLATE * (ix + 0.5);
        const cz = -half + PLATE * (iz + 0.5);
        const present = !inHole(cx, cz);
        plateMap[ix][iz] = present;
        plates.push({ x: cx, z: cz, present });
      }
    }

    // ---- solids: hand-placed blocks first (they are authoritative)
    const solids = [];
    for (const r of shard.roofBlocks || []) solids.push({ ...r, id: `${shard.id}-roof-${solids.length}`, hand: true, roof: true });
    for (const l of shard.landmarks || []) solids.push({ ...l, id: `${shard.id}-lm-${solids.length}`, hand: true });

    const rng = mulberry32(shard.seed);
    const CELL = 34;
    for (let gx = -half + 22; gx < half - 22; gx += CELL) {
      for (let gz = -half + 22; gz < half - 22; gz += CELL) {
        if (rng() > 0.62) continue;
        const w = 10 + rng() * 9;
        const d = 10 + rng() * 9;
        const floors = 2 + Math.floor(rng() * 5);
        const h = floors * 3.4 + 2.5;
        const box = {
          x: gx + (rng() - 0.5) * 8,
          z: gz + (rng() - 0.5) * 8,
          w, d, h,
        };
        const kindRoll = rng();
        if (box.x - w / 2 < bounds[0] + 6 || box.x + w / 2 > bounds[2] - 6) continue;
        if (box.z - d / 2 < bounds[1] + 6 || box.z + d / 2 > bounds[3] - 6) continue;
        const corners = [
          [box.x - w / 2, box.z - d / 2], [box.x + w / 2, box.z - d / 2],
          [box.x - w / 2, box.z + d / 2], [box.x + w / 2, box.z + d / 2],
        ];
        if (corners.some(([x, z]) => inHole(x, z))) continue;
        if (solids.some((o) => boxesOverlap(box, o, 2))) continue;
        if (roadConflicts(box, paths_, false).length) continue;
        solids.push({
          ...box,
          id: `${shard.id}-b-${solids.length}`,
          kind: kindRoll < 0.55 ? 'house' : kindRoll < 0.85 ? 'shop' : 'tenement',
          hand: false,
        });
      }
    }

    // ---- floating furniture and props
    const props = [];
    const propRng = mulberry32(shard.seed * 7 + 11);
    const KINDS = [
      { kind: 'table', r: 1.0, h: 0.8 }, { kind: 'chair', r: 0.5, h: 0.9 },
      { kind: 'bed', r: 1.2, h: 0.6 }, { kind: 'wardrobe', r: 1.0, h: 2.0 },
      { kind: 'crate', r: 0.8, h: 1.0 }, { kind: 'barrel', r: 0.6, h: 1.0 },
      { kind: 'lamp', r: 0.4, h: 1.8 }, { kind: 'bench', r: 0.9, h: 0.6 },
      { kind: 'cart', r: 1.1, h: 1.0 }, { kind: 'stool', r: 0.35, h: 0.6 },
    ];
    const wantProps = 44;
    for (let tries = 0; props.length < wantProps && tries < 2000; tries++) {
      const k = KINDS[Math.floor(propRng() * KINDS.length)];
      const high = propRng() < 0.6;
      const x = -half + 14 + propRng() * (S - 28);
      const z = -half + 14 + propRng() * (S - 28);
      const y = high ? 7 + propRng() * 16 : 2 + propRng() * 3;
      if (solids.some((b) => rectDist(x, z, b) < k.r + 1.5 && y < b.h + 1)) continue;
      const clash = paths_.some((path) => path.samples.some((sm) => {
        if (!sm.exists) return false;
        const dh = Math.abs(sm.y - y);
        const dd = Math.hypot(sm.x - x, sm.z - z);
        return high ? dd < 6 && dh < 8 : dd < 9 && dh < 6;
      }));
      if (clash) continue;
      props.push({
        id: `${shard.id}-p-${props.length}`,
        kind: k.kind, r: k.r, h: k.h,
        x, y, z,
        solid: true,
        motion: {
          bob: 0.5 + propRng() * 1.1,
          period: 9 + propRng() * 11,
          phase: propRng() * TAU,
          orbit: 0.2 + propRng() * 0.9,
        },
        spin: 0.05 + propRng() * 0.18,
        seed: Math.floor(propRng() * 1e6),
      });
    }

    // ---- debris: fractured bits of roof, brick and plaster drifting in the air
    const debris = [];
    const dRng = mulberry32(shard.seed * 13 + 5);
    for (let tries = 0; debris.length < 90 && tries < 4000; tries++) {
      const x = -half + 10 + dRng() * (S - 20);
      const z = -half + 10 + dRng() * (S - 20);
      const y = 3 + dRng() * 30;
      const clash = paths_.some((path) => path.samples.some((sm) => {
        if (!sm.exists) return false;
        return Math.hypot(sm.x - x, sm.z - z) < 5 && Math.abs(sm.y - y) < 6;
      }));
      if (clash) continue;
      debris.push({
        id: `${shard.id}-d-${debris.length}`,
        x, y, z,
        size: 0.4 + dRng() * 2.2,
        aspect: 0.3 + dRng() * 0.7,
        spin: [dRng() * 0.4 - 0.2, dRng() * 0.4 - 0.2, dRng() * 0.4 - 0.2],
        bob: 0.3 + dRng() * 1.2,
        period: 7 + dRng() * 12,
        phase: dRng() * TAU,
        seed: Math.floor(dRng() * 1e6),
      });
    }

    town.shards[shard.id] = {
      id: shard.id,
      size: S,
      plates,
      plateMap,
      holes,
      solids,
      props,
      debris,
      nCells,
    };
  }
  return town;
}

// Checks the layout. Returns { errors, warnings, legs } where legs has per-leg stats.
export function validate(level, paths, town) {
  const errors = [];
  const warnings = [];
  const legs = [];

  // Every road sample must sit inside its shard's footprint (plates only cover the shard).
  level.legs.forEach((def, i) => {
    const shard = level.shards.find((s) => s.id === def.shard);
    const half = shard.size[0] / 2;
    const out = paths[i].samples.filter((sm) => Math.abs(sm.x) > half - 2 || Math.abs(sm.z) > half - 2).length;
    if (out) errors.push(`${def.id}: ${out} road samples are outside shard ${shard.id} (±${half - 2} m). Enlarge the shard or move the points`);
  });

  // Every hand-placed block must pass the same clearance rules as generated ones.
  for (const shard of level.shards) {
    const t = town.shards[shard.id];
    const sp = paths.filter((p, i) => level.legs[i].shard === shard.id);
    for (const b of t.solids.filter((s) => s.hand)) {
      for (const msg of roadConflicts(b, sp, true)) errors.push(`[${shard.id}] hand block ${b.kind}@(${b.x},${b.z}): ${msg}`);
    }
    for (let a = 0; a < t.solids.length; a++) {
      for (let c = a + 1; c < t.solids.length; c++) {
        const A = t.solids[a], B = t.solids[c];
        if (boxesOverlap(A, B, 0)) {
          errors.push(`[${shard.id}] ${A.kind}@(${A.x},${A.z}) overlaps ${B.kind}@(${B.x},${B.z})`);
        }
      }
    }
    // Roads over roofs: must be on top, not floating absurdly high.
    for (const b of t.solids.filter((s) => s.roof)) {
      for (const path of sp) {
        for (const sm of path.samples) {
          if (!sm.exists) continue;
          if (rectDist(sm.x, sm.z, b) === 0 && sm.type === 'roof') {
            if (sm.y > b.h + 6) warnings.push(`[${shard.id}] roof road floats ${(sm.y - b.h).toFixed(1)} m above roof at (${sm.x.toFixed(0)},${sm.z.toFixed(0)})`);
          }
        }
      }
    }
  }

  // Road must not sit over removed ground unless it is a bridge, roof or gap.
  level.legs.forEach((def, i) => {
    const path = paths[i];
    const shard = level.shards.find((s) => s.id === def.shard);
    const t = town.shards[shard.id];
    let overVoid = 0;
    for (const sm of path.samples) {
      if (!sm.exists) continue;
      if ((sm.type === 'street' || sm.type === 'ramp') && onRemovedGround(sm, t.plateMap, t.size)) overVoid++;
    }
    if (overVoid) errors.push(`${def.id}: ${overVoid} street/ramp samples are over a hole. Use 'bridge' type there`);

    // Self-proximity: a leg must not come back past itself (no laps, no shortcuts)
    const S = path.samples;
    let selfClose = 0;
    for (let a = 0; a < S.length; a += 4) {
      for (let b = a + 4; b < S.length; b += 4) {
        if ((b - a) * path.step < 60) continue;
        if (Math.hypot(S[a].x - S[b].x, S[a].z - S[b].z) < 9) { selfClose++; break; }
      }
    }
    if (selfClose) warnings.push(`${def.id}: road passes within 9 m of its own earlier section at ${selfClose} points. Check for accidental loops`);

    // Gaps
    const gaps = [];
    let runStart = null;
    S.forEach((sm, k) => {
      if (!sm.exists && runStart === null) runStart = k;
      if (sm.exists && runStart !== null) { gaps.push(((k - runStart) * path.step).toFixed(1)); runStart = null; }
    });
    for (const g of gaps) {
      if (+g > 16) errors.push(`${def.id}: gap of ${g} m is too wide to jump`);
    }

    legs.push({
      id: def.id,
      name: def.name,
      shard: def.shard,
      length: +path.length.toFixed(1),
      gaps: gaps.map(Number),
      endKind: def.end.kind,
    });
  });

  // Check leg/gate geometry sanity
  for (const l of legs) {
    if (l.length < 100) errors.push(`${l.id}: only ${l.length} m long`);
  }

  return { errors, warnings, legs };
}
