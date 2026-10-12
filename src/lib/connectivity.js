import { createCurve, sampleCurve, sliceRoad } from './curves.js';

const cross = (a, b) => a.x * b.z - a.z * b.x;
export const domain = (road) =>
  ['railway', 'subway'].includes(road.type) ? 'rail' : road.type === 'path' ? 'path' : 'road';
const xyz = (p) => ({ x: p.x, y: p.y || 0, z: p.z });
const key = (p) => `${p.x.toFixed(3)},${p.z.toFixed(3)},${(p.y || 0).toFixed(3)}`;

/** Curve/curve intersections refined in arc-length space, including elevations. */
export function curveIntersections(a, b, preparedA, preparedB) {
  const aa = preparedA || sampleCurve(a),
    bb = preparedB || sampleCurve(b);
  const box = ({ samples }) => ({
    minX: Math.min(...samples.map((s) => s.point.x)),
    maxX: Math.max(...samples.map((s) => s.point.x)),
    minZ: Math.min(...samples.map((s) => s.point.z)),
    maxZ: Math.max(...samples.map((s) => s.point.z)),
  });
  const ba = aa.bounds || (aa.bounds = box(aa)),
    bc = bb.bounds || (bb.bounds = box(bb));
  if (
    ba.minX > bc.maxX + 0.01 ||
    bc.minX > ba.maxX + 0.01 ||
    ba.minZ > bc.maxZ + 0.01 ||
    bc.minZ > ba.maxZ + 0.01
  )
    return [];
  const result = [];
  for (let i = 1; i < aa.samples.length; i++) {
    const p = aa.samples[i - 1].point,
      q = aa.samples[i].point;
    const da = { x: q.x - p.x, z: q.z - p.z };
    for (let j = 1; j < bb.samples.length; j++) {
      const r = bb.samples[j - 1].point,
        s = bb.samples[j].point;
      if (
        Math.min(p.x, q.x) > Math.max(r.x, s.x) + 0.001 ||
        Math.min(r.x, s.x) > Math.max(p.x, q.x) + 0.001 ||
        Math.min(p.z, q.z) > Math.max(r.z, s.z) + 0.001 ||
        Math.min(r.z, s.z) > Math.max(p.z, q.z) + 0.001
      )
        continue;
      const db = { x: s.x - r.x, z: s.z - r.z },
        denominator = cross(da, db);
      if (Math.abs(denominator) < 1e-8) continue;
      const relative = { x: r.x - p.x, z: r.z - p.z };
      const t = cross(relative, db) / denominator,
        u = cross(relative, da) / denominator;
      if (t < -0.00001 || t > 1.00001 || u < -0.00001 || u > 1.00001) continue;
      let sa =
        aa.samples[i - 1].distance + t * (aa.samples[i].distance - aa.samples[i - 1].distance);
      let sb =
        bb.samples[j - 1].distance + u * (bb.samples[j].distance - bb.samples[j - 1].distance);
      for (let k = 0; k < 5; k++) {
        const pa = aa.curve.getPointAt(Math.max(0, Math.min(1, sa / aa.length)));
        const pb = bb.curve.getPointAt(Math.max(0, Math.min(1, sb / bb.length)));
        const ta = aa.curve.getTangentAt(Math.max(0, Math.min(1, sa / aa.length)));
        const tb = bb.curve.getTangentAt(Math.max(0, Math.min(1, sb / bb.length)));
        const den = cross(ta, tb),
          rel = { x: pb.x - pa.x, z: pb.z - pa.z };
        if (Math.abs(den) < 0.0001) break;
        sa = Math.max(0, Math.min(aa.length, sa + cross(rel, tb) / den));
        sb = Math.max(0, Math.min(bb.length, sb + cross(rel, ta) / den));
      }
      const pa = aa.curve.getPointAt(sa / aa.length),
        pb = bb.curve.getPointAt(sb / bb.length);
      if (
        Math.hypot(pa.x - pb.x, pa.z - pb.z) > 0.03 ||
        result.some((hit) => Math.abs(hit.aDistance - sa) < 0.1)
      )
        continue;
      const ta = aa.curve.getTangentAt(sa / aa.length),
        tb = bb.curve.getTangentAt(sb / bb.length);
      result.push({
        x: (pa.x + pb.x) / 2,
        z: (pa.z + pb.z) / 2,
        aY: pa.y,
        bY: pb.y,
        aDistance: sa,
        bDistance: sb,
        aT: sa / aa.length,
        bT: sb / bb.length,
        sine:
          Math.abs(cross(ta, tb)) /
          Math.max(0.001, Math.hypot(ta.x, ta.z) * Math.hypot(tb.x, tb.z)),
      });
    }
  }
  return result;
}

/** Insert a complete template atomically. Rail/road crossings never become junctions. */
export function insertRoads(network, added) {
  if (!added.length) return network;
  const roads = [...network.roads, ...added];
  const newIds = new Set(added.map((r) => r.id));
  const prepared = new Map(roads.map((r) => [r.id, sampleCurve(r)]));
  const cuts = new Map(),
    aliases = new Map();
  const addCut = (road, t, p) => {
    if (!cuts.has(road.id)) cuts.set(road.id, []);
    if (!cuts.get(road.id).some((c) => Math.abs(c.t - t) < 0.00001))
      cuts.get(road.id).push({ t, point: p });
  };
  for (let i = 0; i < roads.length; i++)
    for (let j = i + 1; j < roads.length; j++) {
      const a = roads[i],
        b = roads[j];
      if (
        (!newIds.has(a.id) && !newIds.has(b.id)) ||
        domain(a) !== domain(b) ||
        a.hidden ||
        b.hidden
      )
        continue;
      // Template junctions and grade separations are already explicitly authored.
      if (a.interchangeId && a.interchangeId === b.interchangeId) continue;
      for (const hit of curveIntersections(a, b, prepared.get(a.id), prepared.get(b.id))) {
        if (Math.abs(hit.aY - hit.bY) > 0.12) continue;
        const endA =
          hit.aDistance < 0.05
            ? a.points[0]
            : prepared.get(a.id).length - hit.aDistance < 0.05
              ? a.points.at(-1)
              : null;
        const endB =
          hit.bDistance < 0.05
            ? b.points[0]
            : prepared.get(b.id).length - hit.bDistance < 0.05
              ? b.points.at(-1)
              : null;
        const existing = endB || endA;
        const p = {
          ...(existing ? xyz(existing) : { x: hit.x, z: hit.z, y: (hit.aY + hit.bY) / 2 }),
          nodeId: existing?.nodeId || `junction-${crypto.randomUUID()}`,
        };
        const k = `${domain(a)}|${key(p)}`,
          canonical = aliases.get(k) || p;
        aliases.set(k, canonical);
        addCut(a, endA ? (endA === a.points[0] ? 0 : 1) : hit.aT, canonical);
        addCut(b, endB ? (endB === b.points[0] ? 0 : 1) : hit.bT, canonical);
      }
    }
  const result = roads.flatMap((road) => {
    const parts = cuts.get(road.id) || [];
    // Also share endpoint IDs with other arms already attached at the same place.
    const start = aliases.get(`${domain(road)}|${key(road.points[0])}`) || road.points[0];
    const end = aliases.get(`${domain(road)}|${key(road.points.at(-1))}`) || road.points.at(-1);
    const list = [
      { t: 0, point: start },
      ...parts.filter((p) => p.t > 0.00001 && p.t < 0.99999).sort((a, b) => a.t - b.t),
      { t: 1, point: end },
    ];
    if (list.length === 2) return [{ ...road, points: [start, ...road.points.slice(1, -1), end] }];
    return list
      .slice(1)
      .map((p, i) =>
        sliceRoad(
          road,
          list[i].t,
          p.t,
          list[i].point,
          p.point,
          i === 0 ? road.id : `${road.id}-cut-${crypto.randomUUID().slice(0, 8)}`,
        ),
      )
      .filter((r) => createCurve(r).getLength() > 0.5);
  });
  return { ...network, roads: result };
}
