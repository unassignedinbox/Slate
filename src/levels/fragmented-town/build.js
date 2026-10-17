// Builds the Fragmented Town from its layout.
//
// Everything is deterministic from layout.seed. The output is plain data
// (anchors, items, gates, routes) with no rendering dependency, so the engine
// and the tests can use it directly. src/render turns it into meshes.

import { LAYOUT } from './layout.js';
import { buildRoute, routeAt, nearestS } from '../../engine/spline.js';
import { Anchor } from '../../engine/anchor.js';
import {
  createRng,
  mat4FromBasis,
  mat4Translation,
  sub,
  norm,
  cross,
  madd,
  yawFromForward,
  UP,
} from '../../engine/math.js';
import { makeItem, finalizeItem } from './items.js';
import { buildFracturedBuilding } from './fracture.js';
import { makeFloatingProp, PROP_TYPES } from './props.js';

const PLATE_T = 0.8; // thickness of a road plate
const PLATE_GAP = 0.14; // the visible crack between neighbouring plates
const WAVE_LEN = 46; // wavelength of the travelling wave through the road (m)
const PORTAL_EXIT_OFFSET = 3; // how far in front of an exit gate the car lands
const RESPAWN_OFFSET = 6;

// ── helpers ──────────────────────────────────────────────────────────────────

const flat = (v) => [v[0], 0, v[2]];
const unitXZ = (v) => {
  const l = Math.hypot(v[0], v[2]) || 1;
  return [v[0] / l, 0, v[2] / l];
};
// Horizontal frame for a building that runs along the road: X along the road,
// Z across it, Y up (right-handed).
function buildingFrame(F) {
  const X = unitXZ(F);
  const Z = norm(cross(X, UP));
  return { X, Z };
}

// Is a rectangle (footprint, XZ) clear of every route sample, and of other footprints?
function footprintClear(fp, zones, placed, roadHalf) {
  const { c, X, Z, hw, hd } = fp;
  const rr = Math.hypot(hw, hd);
  for (const other of placed) {
    const dd = Math.hypot(other.c[0] - c[0], other.c[1] - c[1]);
    if (dd < rr + other.rr + 1.5) return false;
  }
  for (const zone of zones) {
    for (let i = 0; i < zone.route.pts.length; i += 2) {
      const q = zone.route.pts[i];
      const dx = q[0] - c[0];
      const dz = q[2] - c[1]; // footprint centres are [x, z]
      if (Math.abs(dx) > rr + roadHalf + 2 || Math.abs(dz) > rr + roadHalf + 2) continue;
      const u = dx * X[0] + dz * X[2];
      const v = dx * Z[0] + dz * Z[2];
      const ex = Math.max(Math.abs(u) - hw, 0);
      const ez = Math.max(Math.abs(v) - hd, 0);
      if (Math.hypot(ex, ez) < roadHalf + 1.2) return false;
    }
  }
  return true;
}

function pointInFootprint(p, fp, margin) {
  const dx = p[0] - fp.c[0];
  const dz = p[2] - fp.c[1]; // footprint centres are [x, z]
  const u = dx * fp.X[0] + dz * fp.X[2];
  const v = dx * fp.Z[0] + dz * fp.Z[2];
  return Math.abs(u) < fp.hw + margin && Math.abs(v) < fp.hd + margin;
}

function routeClearance(p, zones, halfRoad) {
  let best = Infinity;
  for (const zone of zones) {
    for (let i = 0; i < zone.route.pts.length; i += 3) {
      const q = zone.route.pts[i];
      const dx = q[0] - p[0];
      const dz = q[2] - p[2];
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
  }
  return best - halfRoad;
}

// ── road plates and kerbs ────────────────────────────────────────────────────

function makePlates(zone, rng) {
  const { route } = zone;
  const W = 2 * zone.halfW;
  const L = route.length;
  const k = (2 * Math.PI) / WAVE_LEN;
  const plates = [];
  const items = [];
  const matKey = zone.style === 'stair' ? 'roof' : zone.style === 'bridge' ? 'deck' : 'street';

  let a = 0;
  while (a < L - 0.5) {
    let b = Math.min(L, a + rng.range(5.5, 7.5));
    if (L - b < 4) b = L;
    const gap = b < L ? PLATE_GAP : 0;
    const pa = a;
    const pb = b - gap;
    const plen = pb - pa;
    const m = (pa + pb) / 2;
    const smp = routeAt(route, m);
    const centre = madd(smp.p, smp.N, -PLATE_T / 2);
    const anchor = new Anchor({
      home: mat4FromBasis(centre, smp.R, smp.N, smp.F),
      wob: {
        ay: 0.22,
        rx: 0.006,
        rz: 0.006,
        w: 0.55,
        // Shared k*s phase makes a wave that runs along the road.
        p: -k * m + rng.range(-0.15, 0.15),
      },
    });
    const plate = makeItem({ partId: zone.id, role: 'plate', kind: 'box', dims: [W, PLATE_T, plen], mat: matKey, anchor, ground: true });
    items.push(plate);
    plates.push({ s0: pa, s1: pb, item: plate });

    if (zone.kerbs) {
      for (const side of [-1, 1]) {
        const kerbAnchor = new Anchor({
          parent: anchor,
          home: mat4Translation([side * (W / 2 + 0.25), PLATE_T / 2 + 0.45, 0]),
        });
        items.push(makeItem({ partId: zone.id, role: 'kerb', kind: 'box', dims: [0.5, 0.9, plen], mat: 'kerb', anchor: kerbAnchor, solid: true }));
      }
    }
    a = b;
  }
  return { plates, items };
}

// ── buildings ────────────────────────────────────────────────────────────────

function addBuilding(zone, ctx, opts) {
  const { cx, cz, base, X, Z, w, d, floors, roof = true, chimney = true, tower = null } = opts;
  const key = `${zone.id}-${opts.tag}`; // unique per building: gives each house its own shape
  const fp = { c: [cx, cz], X: unitXZ(X), Z: unitXZ(Z), hw: w / 2 + 1.2, hd: d / 2 + 1.2, rr: Math.hypot(w / 2 + 1.2, d / 2 + 1.2) };
  const bld = buildFracturedBuilding({
    rng: ctx.rng.fork(key),
    partId: zone.id,
    base,
    frame: { X: fp.X, Z: fp.Z },
    w,
    d,
    floors,
    roof,
    chimney,
    tower,
    idPrefix: key,
  });
  ctx.footprints.push(fp);
  ctx.items.push(...bld.items);
  ctx.buildingCount = (ctx.buildingCount || 0) + 1;
  return bld;
}

function placeRoadsideBuildings(zone, ctx, cfg) {
  const { route, halfW } = zone;
  const rng = ctx.rng.fork(`${zone.id}-houses`);
  const L = route.length;
  let s = cfg.startAt + rng.range(0, cfg.spacing[1]);
  let n = 0;
  while (s < L - 30) {
    const sides = rng.chance(0.5) ? [1, -1] : [-1, 1];
    for (const side of sides) {
      if (!rng.chance(cfg.chance)) continue;
      const smp = routeAt(route, s + rng.range(-3, 3));
      const w = rng.range(cfg.width[0], cfg.width[1]);
      const d = rng.range(cfg.depth[0], cfg.depth[1]);
      const floors = rng.int(cfg.floors[0], cfg.floors[1]);
      const lat = side * (halfW + 1.4 + d / 2 + rng.range(0, 1.5));
      const cx = smp.p[0] + smp.R[0] * lat;
      const cz = smp.p[2] + smp.R[2] * lat;
      const { X, Z } = buildingFrame(smp.F);
      const fp = { c: [cx, cz], X: unitXZ(X), Z: unitXZ(Z), hw: w / 2 + 1.2, hd: d / 2 + 1.2, rr: Math.hypot(w / 2 + 1.2, d / 2 + 1.2) };
      if (!footprintClear(fp, ctx.zones, ctx.footprints, halfW)) continue;
      const base = [cx, smp.p[1] - 0.4 - rng.range(0, 1), cz];
      addBuilding(zone, ctx, { tag: `h${n++}`, cx, cz, base, X, Z, w, d, floors });
    }
    s += rng.range(cfg.spacing[0], cfg.spacing[1]);
  }
}

// Satellite houses: a loose ring of floating houses around a landmark.
function placeSatellites(zone, ctx, cfg, centre) {
  const rng = ctx.rng.fork(`${zone.id}-satellites`);
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < cfg.count; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(cfg.ring[0], cfg.ring[1]);
    const cx = centre[0] + Math.cos(a) * r;
    const cz = centre[2] + Math.sin(a) * r;
    const w = rng.range(10, 14);
    const d = rng.range(8, 10);
    const yaw = rng.range(0, Math.PI * 2);
    const F = [Math.sin(yaw), 0, Math.cos(yaw)];
    const { X, Z } = buildingFrame(F);
    const fp = { c: [cx, cz], X: unitXZ(X), Z: unitXZ(Z), hw: w / 2 + 1.2, hd: d / 2 + 1.2, rr: Math.hypot(w / 2 + 1.2, d / 2 + 1.2) };
    if (!footprintClear(fp, ctx.zones, ctx.footprints, zone.halfW)) continue;
    const y = rng.range(cfg.height[0], cfg.height[1]);
    addBuilding(zone, ctx, { tag: `sat${placed}`, cx, cz, base: [cx, y, cz], X, Z, w, d, floors: rng.int(1, 3) });
    placed++;
  }
}

// ── props ────────────────────────────────────────────────────────────────────

function placeProps(zone, ctx, cfg) {
  const rng = ctx.rng.fork(`${zone.id}-props`);
  const { route, halfW } = zone;
  const L = route.length;
  const weights = Object.fromEntries(Object.entries(PROP_TYPES).map(([k, v]) => [k, v.weight]));
  const placed = [];
  const discCount = cfg.disc ? cfg.disc.count : 0;
  let made = 0;
  for (let tries = 0; tries < cfg.count * 40 && made < cfg.count; tries++) {
    let pos;
    let yaw = rng.range(0, Math.PI * 2);
    const useDisc = cfg.disc && made < discCount;
    if (useDisc) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * cfg.disc.radius[1];
      pos = [cfg.disc.center[0] + Math.cos(a) * r, rng.range(cfg.disc.height[0], cfg.disc.height[1]), cfg.disc.center[1] + Math.sin(a) * r];
    } else {
      const smp = routeAt(route, rng.range(0, L));
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * (halfW + rng.range(cfg.roadside[0], cfg.roadside[1]));
      const y = smp.p[1] + rng.range(cfg.height[0], cfg.height[1]);
      pos = [smp.p[0] + smp.R[0] * lat, y, smp.p[2] + smp.R[2] * lat];
    }
    if (routeClearance(pos, ctx.zones, halfW) < 2.2) continue;
    if (ctx.footprints.some((fp) => pointInFootprint(pos, fp, 1.5))) continue;
    if (placed.some((q) => Math.hypot(q[0] - pos[0], q[1] - pos[1], q[2] - pos[2]) < 3)) continue;
    const type = rng.weighted(weights);
    const prop = makeFloatingProp({ rng: rng.fork(`p${made}`), partId: zone.id, type, pos, yaw, idPrefix: `${zone.id}-p${made}` });
    ctx.items.push(...prop.items);
    placed.push(pos);
    made++;
  }
  return made;
}

// Far-off floating islands, purely for scale. They are never drivable or solid.
function placeFarIslands(zone, ctx, count) {
  const rng = ctx.rng.fork(`${zone.id}-far`);
  const c = zone.route.pts[Math.floor(zone.route.pts.length / 2)];
  let made = 0;
  for (let tries = 0; tries < count * 30 && made < count; tries++) {
    const pos = [c[0] + rng.range(-650, 650), c[1] + rng.range(-70, 110), c[2] + rng.range(-650, 650)];
    if (routeClearance(pos, ctx.zones, 0) < 140) continue;
    const dims = [rng.range(28, 80), rng.range(5, 16), rng.range(28, 80)];
    const anchor = new Anchor({
      home: mat4Translation(pos),
      wob: { ay: rng.range(0.6, 1.4), rz: 0.01, rx: 0.01, w: rng.range(0.05, 0.12), p: rng.range(0, 6.28), spinY: rng.range(-0.005, 0.005) },
    });
    ctx.items.push(makeItem({ partId: 'far', role: 'far', kind: 'box', dims, mat: 'island', anchor, cast: false }));
    made++;
  }
}

// ── gates and portals ────────────────────────────────────────────────────────

function makeGate({ id, label, role, zone, s, order }) {
  const smp = routeAt(zone.route, s);
  const halfW = zone.halfW;
  const anchor = new Anchor({ home: mat4FromBasis(smp.p, smp.R, smp.N, smp.F) });
  const gate = {
    id,
    label,
    role,
    partId: zone.id,
    order,
    s,
    pos: smp.p,
    fwd: smp.F,
    right: smp.R,
    up: smp.N,
    halfW,
    halfH: 6,
    pair: null,
    exitPose: null,
    respawn: null,
  };
  const frameLocal = (x, y, z, dims, kind, mat, solid, role2) => {
    const a = new Anchor({ parent: anchor, home: mat4Translation([x, y, z]) });
    const it = makeItem({ partId: zone.id, role: role2 ?? 'gate', kind, dims, mat, anchor: a, solid, cast: kind !== 'plane' });
    it.id = `${id}-${kind}-${x.toFixed(1)}-${y.toFixed(1)}`;
    return it;
  };
  const items = [
    frameLocal(-(halfW + 0.6), 4.5, 0, [1.2, 9, 1.2], 'box', 'gate', true),
    frameLocal(halfW + 0.6, 4.5, 0, [1.2, 9, 1.2], 'box', 'gate', true),
    frameLocal(0, 9.1, 0, [2 * halfW + 2.4, 1.2, 1.2], 'box', 'gate', false),
  ];
  if (role === 'entry' || role === 'exit') {
    items.push(frameLocal(0, 4.5, 0.05, [2 * halfW, 9], 'plane', role === 'entry' ? 'portal' : 'portalExit', false, 'portal'));
  }
  if (role === 'finish') {
    items.push(frameLocal(0, 7.4, 0.12, [2 * halfW, 1.4], 'plane', 'banner', false, 'banner'));
  }
  gate.items = items;
  return gate;
}

// ── assembly ─────────────────────────────────────────────────────────────────

export function buildFragmentedTown(layout = LAYOUT) {
  const rng = createRng(layout.seed);
  const halfW = layout.roadWidth / 2;

  // 1. Routes. A zone with a runway gets a straight lead-in before its start arch.
  const zones = layout.zones.map((z) => {
    let cps = z.controlPoints.map((p) => p.slice());
    if (z.runway) {
      const F0 = norm(sub(cps[1], cps[0]));
      const back = (k) => [cps[0][0] - F0[0] * k, cps[0][1] - F0[1] * k, cps[0][2] - F0[2] * k];
      cps = [back(z.runway), back(z.runway / 2), ...cps];
    }
    const route = buildRoute(z.id, cps);
    const startS = z.runway ? nearestS(route, z.controlPoints[0], z.runway, 10) : 0;
    return {
      id: z.id,
      name: z.name,
      subtitle: z.subtitle,
      style: z.style,
      kerbs: !!z.kerbs,
      halfW,
      route,
      startS,
      endS: route.length,
      layout: z,
      items: [],
      plates: [],
    };
  });

  const ctx = { rng, zones, items: [], footprints: [] };

  // 2. Road plates and kerbs.
  for (const zone of zones) {
    const { plates, items } = makePlates(zone, rng.fork(`${zone.id}-plates`));
    zone.plates = plates;
    ctx.items.push(...items);
  }

  // 3. Landmarks first (they claim space), then roadside houses, satellites, props.
  for (const zone of zones) {
    const z = zone.layout;
    if (z.landmark?.kind === 'chapel') {
      const lm = z.landmark;
      const c = lm.at;
      const X = [1, 0, 0];
      const Z = [0, 0, 1];
      addBuilding(zone, ctx, {
        tag: 'chapel',
        cx: c[0],
        cz: c[2],
        base: [c[0], c[1], c[2]],
        X,
        Z,
        w: lm.width,
        d: lm.depth,
        floors: lm.floors,
        roof: false,
        chimney: false,
        tower: { size: 5.2, height: 17 },
      });
      zone.landmarkCentre = c;
    }
    if (z.landmark?.kind === 'mill') {
      const lm = z.landmark;
      const s = lm.atS * zone.route.length;
      const smp = routeAt(zone.route, s);
      const { X, Z } = buildingFrame(smp.F);
      const d = lm.depth;
      const side = lm.side;
      const lat = side * (halfW + 30 + d / 2);
      const cx = smp.p[0] + smp.R[0] * lat;
      const cz = smp.p[2] + smp.R[2] * lat;
      addBuilding(zone, ctx, { tag: 'mill', cx, cz, base: [cx, smp.p[1] - 0.4, cz], X, Z, w: lm.width, d, floors: lm.floors });
      // The mill wheel: a vertical ring facing along the road, beside the deck.
      const wr = lm.wheelRadius;
      const wc = [smp.p[0] + smp.R[0] * side * (halfW + 15), smp.p[1] + 14, smp.p[2] + smp.R[2] * side * (halfW + 15)];
      // The wheel turns slowly about its own axis (local Z = along the road).
      const wAnchor = new Anchor({ home: mat4FromBasis(wc, smp.R, smp.N, smp.F), wob: { spinZ: 0.12 } });
      ctx.items.push(makeItem({ partId: zone.id, role: 'wheel', kind: 'torus', dims: [wr, 0.35], mat: 'metal', anchor: wAnchor, cast: true }));
      for (const dims of [[2 * wr, 0.25, 0.25], [0.25, 2 * wr, 0.25]]) {
        const a = new Anchor({ parent: wAnchor });
        ctx.items.push(makeItem({ partId: zone.id, role: 'wheel', kind: 'box', dims, mat: 'trim', anchor: a, cast: true }));
      }
      zone.landmarkCentre = [wc[0], wc[1], wc[2]];
    }
  }

  for (const zone of zones) {
    const z = zone.layout;
    placeRoadsideBuildings(zone, ctx, z.buildings);
    if (z.satellites) placeSatellites(zone, ctx, z.satellites, zone.landmarkCentre ?? zone.route.pts[0]);
  }
  for (const zone of zones) {
    placeProps(zone, ctx, zone.layout.props);
    placeFarIslands(zone, ctx, zone.layout.far);
  }

  // 4. Start, portals and finish. Gate order is the order the race expects.
  const gates = [];
  const gateOrder = [];
  const first = zones[0];
  const spawnSmp = routeAt(first.route, 0);
  const spawn = { pos: spawnSmp.p, yaw: yawFromForward(spawnSmp.F), partId: first.id };

  const startGate = makeGate({ id: 'start', label: 'Start', role: 'start', zone: first, s: first.startS, order: 0 });
  startGate.respawn = spawn;
  gates.push(startGate);
  gateOrder.push(startGate);

  layout.portals.forEach((p, k) => {
    const from = zones.find((z) => z.id === p.from);
    const to = zones.find((z) => z.id === p.to);
    const entry = makeGate({ id: `portal-${k + 1}`, label: `Portal ${k + 1}`, role: 'entry', zone: from, s: from.endS, order: gateOrder.length });
    const exit = makeGate({ id: `portal-${k + 1}-exit`, label: `Portal ${k + 1} exit`, role: 'exit', zone: to, s: to.startS, order: -1 });
    const exitSmp = routeAt(to.route, PORTAL_EXIT_OFFSET);
    exit.exitPose = { pos: exitSmp.p, yaw: yawFromForward(exitSmp.F), partId: to.id };
    const respawnSmp = routeAt(to.route, RESPAWN_OFFSET);
    exit.respawn = { pos: respawnSmp.p, yaw: yawFromForward(respawnSmp.F), partId: to.id };
    entry.pair = exit;
    gates.push(entry, exit);
    gateOrder.push(entry);
  });

  const last = zones[zones.length - 1];
  const finish = makeGate({ id: 'finish', label: 'Finish', role: 'finish', zone: last, s: last.endS, order: gateOrder.length });
  finish.respawn = gates[gates.length - 1].respawn;
  gates.push(finish);
  gateOrder.push(finish);

  for (const g of gates) ctx.items.push(...g.items);

  // 5. Assemble the level and finalise item culling data.
  const items = ctx.items;
  for (const it of items) finalizeItem(it);
  const ground = items.filter((it) => it.ground);
  const solids = items.filter((it) => it.solid);

  for (const zone of zones) {
    zone.items = items.filter((it) => it.partId === zone.id);
  }

  // Map bounds (for the overview map).
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const zone of zones) {
    for (const p of zone.route.pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
  }

  const legLengths = zones.map((z) => ({ id: z.id, name: z.name, length: z.route.length - z.startS }));
  const counts = {
    plates: ground.length,
    kerbs: items.filter((i) => i.role === 'kerb').length,
    buildings: ctx.buildingCount,
    shards: items.filter((i) => ['wall', 'floor', 'roof', 'chimney', 'tower', 'spire'].includes(i.role)).length,
    props: items.filter((i) => i.role === 'prop').length,
    solids: solids.length,
    items: items.length,
  };

  return {
    id: layout.id,
    name: layout.name,
    inWorldName: layout.inWorldName,
    section: layout.section,
    seed: layout.seed,
    killY: layout.killY,
    spawn,
    parts: zones,
    partsById: Object.fromEntries(zones.map((z) => [z.id, z])),
    gates,
    gateOrder,
    items,
    ground,
    solids,
    bounds: { minX, maxX, minZ, maxZ },
    legLengths,
    counts,
  };
}

