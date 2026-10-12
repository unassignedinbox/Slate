import { sampleCurve, frameAt } from './curves.js';
import { curveIntersections } from './connectivity.js';
import { roadWidth, isRail, isBridge } from './profiles.js';

export function mergeIntervals(intervals, min = 0, max = Infinity) {
  const sorted = intervals
    .map(([a, b]) => [Math.max(min, a), Math.min(max, b)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const span of sorted) {
    if (result.length && span[0] <= result.at(-1)[1] + 0.01)
      result.at(-1)[1] = Math.max(span[1], result.at(-1)[1]);
    else result.push([...span]);
  }
  return result;
}
export function subtractIntervals(from, to, blocked) {
  const result = [];
  let cursor = from;
  for (const [a, b] of mergeIntervals(blocked, from, to)) {
    if (a > cursor) result.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < to) result.push([cursor, to]);
  return result;
}
export function distanceToPath(p, prepared) {
  let closest = { distance: Infinity, y: 0, along: 0 };
  const samples = prepared.samples;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].point,
      b = samples[i].point;
    const dx = b.x - a.x,
      dz = b.z - a.z,
      l = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, l ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l : 0));
    const distance = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
    if (distance < closest.distance)
      closest = {
        distance,
        y: a.y + (b.y - a.y) * t,
        along: samples[i - 1].distance + (samples[i].distance - samples[i - 1].distance) * t,
      };
  }
  return closest;
}

export function planInfrastructure(network, { includeHidden = false } = {}) {
  const roads = network.roads.filter((r) => includeHidden || !r.hidden);
  const prepared = new Map(roads.map((r) => [r.id, { ...sampleCurve(r, 3, 700), road: r }]));
  const rails = roads.filter((r) => r.type === 'railway' && r.crossings !== false);
  const crossings = [],
    roadCrossings = new Map(),
    railCrossings = new Map();
  for (const rail of rails)
    for (const road of roads.filter((r) => !isRail(r) && r.type !== 'path')) {
      for (const hit of curveIntersections(
        rail,
        road,
        prepared.get(rail.id),
        prepared.get(road.id),
      )) {
        if (Math.abs(hit.aY - hit.bY) > 0.06 || hit.sine < 0.12) continue;
        const cosine = Math.sqrt(Math.max(0, 1 - hit.sine ** 2));
        const roadHalf = (roadWidth(rail) / 2 + 0.8 + (roadWidth(road) / 2) * cosine) / hit.sine;
        const railHalf = (roadWidth(road) / 2 + 0.8 + (roadWidth(rail) / 2) * cosine) / hit.sine;
        const crossing = {
          ...hit,
          id: `crossing-${rail.id}-${road.id}-${crossings.length}`,
          rail,
          road,
          y: (hit.aY + hit.bY) / 2,
          roadSpan: [hit.bDistance - roadHalf, hit.bDistance + roadHalf],
          railSpan: [hit.aDistance - railHalf, hit.aDistance + railHalf],
        };
        crossings.push(crossing);
        if (!roadCrossings.has(road.id)) roadCrossings.set(road.id, []);
        if (!railCrossings.has(rail.id)) railCrossings.set(rail.id, []);
        roadCrossings.get(road.id).push(crossing.roadSpan);
        railCrossings.get(rail.id).push(crossing.railSpan);
      }
    }
  for (const [id, spans] of roadCrossings)
    roadCrossings.set(id, mergeIntervals(spans, 0, prepared.get(id).length));
  for (const [id, spans] of railCrossings)
    railCrossings.set(id, mergeIntervals(spans, 0, prepared.get(id).length));
  const elevated = roads.filter((r) => isBridge(r) || r.type === 'ramp');
  const below = (p, margin = 2) =>
    elevated.some((r) => {
      const near = distanceToPath(p, prepared.get(r.id));
      return near.distance < roadWidth(r) / 2 + margin && near.y > (p.y || 0) + 1;
    });
  const railInfluence = (p) => {
    let influence = 0;
    for (const r of rails) {
      const near = distanceToPath(p, prepared.get(r.id));
      if (Math.abs(near.y - p.y) > 0.3) continue;
      const d = near.distance - roadWidth(r) / 2 - 0.7;
      const t = Math.max(0, Math.min(1, 1 - d / 3));
      influence = Math.max(influence, t * t * (3 - 2 * t));
    }
    return influence;
  };
  return { prepared, crossings, roadCrossings, railCrossings, below, railInfluence };
}

export const PIER_FOOTING = Object.freeze({ width: 1.8, length: 2.6, height: 0.4, bottom: -0.28 });

/** Test each physical pier/footing, not just the bridge centreline. */
export function bridgeSupports(road, infrastructure, plan) {
  const prepared = infrastructure.prepared.get(road.id);
  if (!prepared) return [];
  const from = plan?.startTrim || 0,
    to = prepared.length - (plan?.endTrim || 0),
    result = [];
  const thickness = road.deckThickness || 0.8;
  const spacing = road.bridgeSupportSpacing || 32;
  for (let d = from + Math.min(16, spacing / 2); d < to - 12; d += spacing) {
    const s = frameAt(prepared.curve, d, prepared.length);
    if (s.point.y - thickness < 1.4) continue;
    const feet = [-1, 1].map((side) =>
      s.point.clone().addScaledVector(s.normal, side * roadWidth(road) * 0.34),
    );
    const radius = Math.hypot(PIER_FOOTING.width / 2, PIER_FOOTING.length / 2) + 0.5;
    const blocked = [...infrastructure.prepared].some(([id, path]) => {
      if (id === road.id || !path.road) return false;
      return feet.some((foot) => {
        const near = distanceToPath(foot, path);
        return near.y < s.point.y - 1.2 && near.distance < roadWidth(path.road) / 2 + radius;
      });
    });
    if (!blocked) result.push({ ...s, feet, height: s.point.y - thickness + 0.075 });
  }
  return result;
}

export function bridgeReport(road, network) {
  const source = sampleCurve(road, 3),
    thickness = road.deckThickness || 0.8;
  let maxGrade = 0;
  for (let i = 1; i < source.samples.length; i++) {
    const a = source.samples[i - 1].point,
      b = source.samples[i].point;
    maxGrade = Math.max(
      maxGrade,
      (Math.abs(b.y - a.y) / Math.max(0.001, Math.hypot(b.x - a.x, b.z - a.z))) * 100,
    );
  }
  const crossings = [];
  for (const other of network.roads.filter((r) => r.id !== road.id && !r.hidden)) {
    for (const hit of curveIntersections(road, other, source))
      if (hit.aY > hit.bY + 1) {
        crossings.push({
          roadId: other.id,
          clearance: hit.aY - thickness + 0.075 - (hit.bY + 0.1),
        });
      }
  }
  return {
    crossings,
    clearance: crossings.length ? Math.min(...crossings.map((c) => c.clearance)) : null,
    maxGrade,
  };
}

/** Do not silently stack a template's ground-level mainlines on parallel
 * existing streets. Perpendicular at-grade intersections are connected by
 * insertRoads; grade-separated crossings are intentionally untouched.
 */
export function structurePlacementConflict(network, added) {
  const existing = network.roads
    .filter((r) => !isRail(r) && r.type !== 'path' && !r.hidden)
    .map((r) => ({ ...sampleCurve(r, 5), road: r }));
  for (const road of added.filter((r) => r.mainline)) {
    const path = sampleCurve(road, 12, 160);
    for (const other of existing) {
      let matches = 0;
      for (const s of path.samples) {
        const near = distanceToPath(s.point, other);
        if (
          Math.abs(near.y - s.point.y) > 0.15 ||
          near.distance >= (roadWidth(road) + roadWidth(other.road)) / 2 - 0.3
        )
          continue;
        const a = path.curve.getTangentAt(s.t),
          b = other.curve.getTangentAt(near.along / other.length);
        if (Math.abs(a.x * b.x + a.z * b.z) > 0.985 && ++matches >= 3) return other.road.name;
      }
    }
  }
  return null;
}
