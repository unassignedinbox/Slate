import { frameAt } from './curves.js';
import { roadWidth } from './profiles.js';
import { buildTopology, SURFACE_Y, PAVING_Y } from './topology.js';
import { planInfrastructure, distanceToPath, subtractIntervals } from './infrastructure.js';
import { markingPlan, authoredMarkingDistance } from './markings.js';

export const DRAINAGE_TYPES = [
  { id: 'none', name: 'None' },
  { id: 'grate', name: 'Gutter grate' },
  { id: 'inlet', name: 'Kerb opening' },
  { id: 'slot', name: 'Linear slot drain' },
  { id: 'combined', name: 'Grate + kerb inlet' },
];
export const isCurbAccess = (prop) => ['driveway', 'curbRamp'].includes(prop.type);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

export function accessOnPlan(plan, type, distance, side, width, depth, infrastructure) {
  if (plan.road.sidewalk < 0.6 || ['path', 'railway', 'subway'].includes(plan.road.type))
    return null;
  width = clamp(width ?? (type === 'driveway' ? 4.5 : 2.4), 1.2, 12);
  const flare = type === 'driveway' ? 0.9 : 0.6,
    half = width / 2 + flare;
  const allowed = subtractIntervals(
    plan.startTrim + 0.4,
    plan.length - plan.endTrim - 0.4,
    (infrastructure.roadCrossings.get(plan.road.id) || []).map(([a, b]) => [a - 4, b + 4]),
  ).filter(([a, b]) => b - a > 2 * half);
  if (!allowed.length) return null;
  distance = allowed
    .map(([a, b]) => clamp(distance, a + half, b - half))
    .sort((a, b) => Math.abs(a - distance) - Math.abs(b - distance))[0];
  side = side < 0 ? -1 : 1;
  depth = clamp(depth ?? Math.min(2.4, plan.road.sidewalk), 0.5, plan.road.sidewalk);
  const frame = frameAt(plan.curve, distance, plan.length),
    p = frame.point
      .clone()
      .addScaledVector(frame.normal, side * (plan.carriage / 2 + plan.road.sidewalk / 2));
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    rotation: Math.atan2(frame.tangent.x, frame.tangent.z),
    roadId: plan.road.id,
    width,
    depth,
    side,
    distance,
    frame,
    plan,
    flare,
  };
}

export function curbAccessPlacement(network, type, position, preferredId, context) {
  const topology = context?.topology || buildTopology(network),
    infrastructure = context?.infrastructure || planInfrastructure(network);
  let best;
  for (const plan of topology.plans.values()) {
    if (plan.road.sidewalk < 0.6) continue;
    const path = infrastructure.prepared.get(plan.road.id),
      near = distanceToPath(position, path);
    if (near.distance > roadWidth(plan.road) / 2 + 8) continue;
    const frame = frameAt(plan.curve, near.along, plan.length);
    const side =
      (position.x - frame.point.x) * frame.normal.x +
        (position.z - frame.point.z) * frame.normal.z <
      0
        ? -1
        : 1;
    const placement = accessOnPlan(
      plan,
      type,
      near.along,
      side,
      position.width,
      position.rampDepth,
      infrastructure,
    );
    if (!placement) continue;
    const score =
      near.distance +
      Math.abs(near.y - (position.y || 0)) * 2 +
      Math.abs(placement.distance - near.along) * 0.4 -
      (preferredId === plan.road.id ? 0.1 : 0);
    if (!best || score < best.score) best = { ...placement, score };
  }
  return best || null;
}
export function anchorCurbAccess(prop, placement) {
  return {
    ...prop,
    x: placement.x,
    y: placement.y,
    z: placement.z,
    rotation: placement.rotation,
    roadId: placement.roadId,
    width: placement.width,
    rampDepth: placement.depth,
    curbAnchor: { t: placement.distance / placement.plan.length, side: placement.side },
  };
}
export function resolveCurbAccess(network, prop, context) {
  if (!isCurbAccess(prop) || !prop.roadId || !prop.curbAnchor) return null;
  const topology = context?.topology || buildTopology(network),
    infrastructure = context?.infrastructure || planInfrastructure(network);
  const plan = topology.plans.get(prop.roadId);
  if (!plan) return null;
  const placement = accessOnPlan(
    plan,
    prop.type,
    prop.curbAnchor.t * plan.length,
    prop.curbAnchor.side,
    prop.width,
    prop.rampDepth,
    infrastructure,
  );
  return placement ? { ...placement, prop: anchorCurbAccess(prop, placement) } : null;
}

/** One planner for road-side paving, actual curb gaps, ramps and drain hardware. */
export function planStreetscape(network, plan, infrastructure) {
  const road = plan.road,
    from = plan.startTrim,
    to = plan.length - plan.endTrim;
  const railSpans = infrastructure.roadCrossings.get(road.id) || [];
  const ramps = [];
  if (road.sidewalk > 0 && road.crosswalkRamps !== false) {
    const crossingDistances = road.markings
      ? markingPlan(plan, railSpans).zebras.map((z) => ({
          distance: z.distance,
          id: `${road.id}-zebra-${z.end}`,
        }))
      : [];
    for (const prop of network.props || [])
      if (prop.type === 'crosswalk' && prop.roadId === road.id && prop.roadAnchor) {
        const distance = authoredMarkingDistance(
          plan,
          'crosswalk',
          prop.roadAnchor.t * plan.length,
          railSpans,
        );
        if (distance !== null) crossingDistances.push({ distance, id: prop.id });
      }
    for (const crossing of crossingDistances)
      for (const side of [-1, 1]) {
        const distance = crossing.distance;
        if (railSpans.some(([a, b]) => distance >= a - 4 && distance <= b + 4)) continue;
        ramps.push({
          ...crossing,
          side,
          width: 3,
          depth: Math.min(2.4, road.sidewalk),
          flare: 0.5,
          type: 'curbRamp',
          automatic: true,
        });
      }
  }
  for (const prop of network.props || []) {
    if (!isCurbAccess(prop) || prop.roadId !== road.id || !prop.curbAnchor) continue;
    const resolved = resolveCurbAccess(network, prop, {
      topology: { plans: new Map([[road.id, plan]]) },
      infrastructure,
    });
    if (resolved) {
      // A custom pedestrian drop replaces a coincident generated pad, so width
      // edits take effect and coplanar tactile surfaces cannot z-fight.
      if (prop.type === 'curbRamp')
        for (let i = ramps.length - 1; i >= 0; i--)
          if (
            ramps[i].automatic &&
            ramps[i].side === resolved.side &&
            Math.abs(ramps[i].distance - resolved.distance) < 0.6
          )
            ramps.splice(i, 1);
      ramps.push({ ...resolved, type: prop.type, id: prop.id, propId: prop.id });
    }
  }
  // Overlapping drops share a surface, but drain hardware must not block them.
  const rampWeight = (d, side) =>
    ramps
      .filter((r) => r.side === side)
      .reduce((weight, r) => {
        const t = clamp((r.width / 2 + r.flare - Math.abs(d - r.distance)) / r.flare, 0, 1);
        return Math.max(weight, smooth(t));
      }, 0);
  const pavingLift = (d, offset, side) => {
    const u = Math.max(0, side * offset - plan.carriage / 2);
    let drop = 0;
    for (const r of ramps.filter((r) => r.side === side)) {
      const t = smooth(clamp((r.width / 2 + r.flare - Math.abs(d - r.distance)) / r.flare, 0, 1));
      drop = Math.max(drop, t * (1 - clamp(u / r.depth, 0, 1)));
    }
    return PAVING_Y - (PAVING_Y - SURFACE_Y) * drop;
  };
  const type = road.drainage || 'none',
    drains = [],
    slotSpans = new Map();
  for (const side of [-1, 1]) {
    const blocked = [
      ...railSpans.map(([a, b]) => [a - 4, b + 4]),
      ...ramps
        .filter((r) => r.side === side)
        .map((r) => [
          r.distance - r.width / 2 - r.flare - 1,
          r.distance + r.width / 2 + r.flare + 1,
        ]),
    ];
    const allowed = subtractIntervals(from + 3, to - 3, blocked);
    if (road.curbs && road.sidewalk > 0 && type === 'slot') slotSpans.set(side, allowed);
    if (!road.curbs || !road.sidewalk || !['grate', 'inlet', 'combined'].includes(type)) continue;
    const spacing = clamp(road.drainSpacing ?? 30, 8, 100),
      phase = road.markingPhase || 0;
    for (
      let d = Math.ceil((from + 5 + phase) / spacing) * spacing - phase;
      d < to - 5;
      d += spacing
    )
      if (allowed.some(([a, b]) => d - 0.9 >= a && d + 0.9 <= b))
        drains.push({ distance: d, side, type });
  }
  return { ramps, drains, slotSpans, rampWeight, pavingLift };
}

/** Add exact ramp/flared-edge stations to ordinary sampling, so a curb drop
 * cannot disappear between 2.5 m road samples or turn into a raised box. */
export function streetscapeDistances(from, to, ramps, base = []) {
  const ds = [from, to, ...base.filter((d) => d >= from && d <= to)];
  for (const r of ramps) {
    const a = r.distance - r.width / 2 - r.flare,
      b = r.distance + r.width / 2 + r.flare;
    for (const d of [a, a + r.flare, r.distance, b - r.flare, b])
      if (d > from && d < to) ds.push(d);
    for (let d = Math.max(from, a); d < Math.min(to, b); d += 0.5) ds.push(d);
  }
  return [...new Set(ds.map((d) => Number(d.toFixed(6))))].sort((a, b) => a - b);
}
