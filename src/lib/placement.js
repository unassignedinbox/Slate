import { roadWidth, laneLayout, laneDirection } from './profiles.js';
import { frameAt, createCurve } from './curves.js';
import { distanceToPath, planInfrastructure } from './infrastructure.js';
import { buildTopology } from './topology.js';
import { authoredMarkingDistance } from './markings.js';
import {
  isCurbAccess,
  curbAccessPlacement,
  anchorCurbAccess,
  resolveCurbAccess,
} from './streetscape.js';

export const isRoadAttachedDetail = (p) => isRoadMarking(p) || isCurbAccess(p);
export const resolveAttachedDetail = (network, p, context) =>
  isCurbAccess(p)
    ? resolveCurbAccess(network, p, context)
    : resolveRoadMarking(network, p, context);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
export const isRoadMarking = (prop) => ['arrow', 'crosswalk'].includes(prop.type);
const placementContext = (network, context) => ({
  topology: context?.topology || buildTopology(network),
  infrastructure: context?.infrastructure || planInfrastructure(network),
});

function placementOnPlan(plan, type, distance, offset, infrastructure) {
  distance = authoredMarkingDistance(
    plan,
    type,
    distance,
    infrastructure.roadCrossings.get(plan.road.id) || [],
  );
  if (distance === null) return null;
  const s = frameAt(plan.curve, distance, plan.length);
  const width = type === 'arrow' ? Math.min(1.6, plan.carriage - 0.3) : plan.carriage - 0.4;
  offset =
    type === 'crosswalk'
      ? 0
      : clamp(offset, -plan.carriage / 2 + width / 2 + 0.15, plan.carriage / 2 - width / 2 - 0.15);
  const p = s.point.clone().addScaledVector(s.normal, offset);
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    rotation: Math.atan2(s.tangent.x, s.tangent.z),
    width,
    roadId: plan.road.id,
    distance,
    offset,
    plan,
    frame: s,
  };
}

/** Surface-aware picking. A renderer may constrain resolution to the authored
 * road; an explicit drag may instead choose a new road, including another level.
 */
export function detailPlacement(network, type, position, preferredId, context) {
  if (isCurbAccess({ type }))
    return curbAccessPlacement(network, type, position, preferredId, context);
  const { topology, infrastructure } = placementContext(network, context);
  const marking = isRoadMarking({ type });
  let best;
  for (const plan of topology.plans.values()) {
    if (plan.road.type === 'path' || (context?.preferredOnly && plan.road.id !== preferredId))
      continue;
    const path = infrastructure.prepared.get(plan.road.id);
    if (!path) continue;
    const near = distanceToPath(position, path);
    if (near.distance > plan.width / 2 + (marking ? 1 : 12)) continue;
    let placement;
    if (marking) {
      const s = frameAt(plan.curve, near.along, plan.length);
      const offset = (position.x - s.point.x) * s.normal.x + (position.z - s.point.z) * s.normal.z;
      placement = placementOnPlan(plan, type, near.along, offset, infrastructure);
      if (!placement) continue;
    }
    const score =
      near.distance +
      Math.abs(near.y - (position.y || 0)) * 2 +
      (placement ? Math.abs(placement.distance - near.along) * 0.25 : 0) -
      (plan.road.id === preferredId ? 0.1 : 0);
    if (!best || score < best.score) best = { plan, near, placement, score };
  }
  if (!best) return marking ? null : { ...position, rotation: 0, width: 7 };
  if (marking) return best.placement;
  const s = frameAt(best.plan.curve, best.near.along, best.plan.length);
  return {
    ...position,
    y: position.y || 0,
    rotation: Math.atan2(s.tangent.x, s.tangent.z),
    width: Math.max(3, roadWidth(best.plan.road) - best.plan.road.sidewalk * 2),
    roadId: best.plan.road.id,
    plan: best.plan,
    frame: s,
    distance: best.near.along,
    offset: 0,
  };
}

/** Model coordinates and rendered coordinates share this same resolved anchor.
 * A normalized arc position follows reshaping; lateral/height/heading offsets
 * remain in the road frame, rather than silently drifting in world space.
 */
export function anchorRoadMarking(
  prop,
  placement,
  { snapLane = false, standard = 'us', angle, lift } = {},
) {
  let offset = placement.offset;
  angle ??=
    prop.roadAnchor?.angle ?? wrapAngle((prop.rotation ?? placement.rotation) - placement.rotation);
  lift = clamp(lift ?? prop.roadAnchor?.lift ?? 0, 0, 0.03);
  if (prop.type === 'crosswalk') {
    offset = 0;
    angle = 0;
  } else if (snapLane) {
    const band = laneLayout(placement.plan.road)
      .filter((b) => b.kind === 'lane')
      .sort((a, b) => Math.abs(a.center - offset) - Math.abs(b.center - offset))[0];
    if (band) {
      offset = band.center;
      angle = laneDirection(placement.plan.road, band.side, standard) === -1 ? Math.PI : 0;
    }
  }
  const frame = placement.frame;
  const p = frame.point.clone().addScaledVector(frame.normal, offset);
  return {
    ...prop,
    x: p.x,
    y: p.y + lift,
    z: p.z,
    rotation: wrapAngle(placement.rotation + angle),
    width:
      prop.type === 'crosswalk'
        ? clamp(prop.width ?? placement.width, 0.2, placement.width)
        : placement.width,
    roadId: placement.roadId,
    roadAnchor: {
      t: placement.distance / placement.plan.length,
      offset,
      lift,
      angle: wrapAngle(angle),
    },
  };
}

export function resolveRoadMarking(network, prop, context) {
  if (!isRoadMarking(prop) || !prop.roadId) return null;
  const ctx = placementContext(network, context),
    plan = ctx.topology.plans.get(prop.roadId);
  if (!plan || plan.road.type === 'path') return null;
  let placement;
  if (prop.roadAnchor) {
    placement = placementOnPlan(
      plan,
      prop.type,
      prop.roadAnchor.t * plan.length,
      prop.roadAnchor.offset,
      ctx.infrastructure,
    );
  } else {
    placement = detailPlacement(network, prop.type, prop, prop.roadId, {
      ...ctx,
      preferredOnly: true,
    });
  }
  if (!placement) return null;
  return { ...placement, prop: anchorRoadMarking(prop, placement) };
}

export function updatePlacedDetail(network, prop, changes, context) {
  if (isCurbAccess(prop)) {
    const { curbSide, surfaceLift, ...transform } = changes;
    const candidate = {
      ...prop,
      ...transform,
      ...(curbSide ? { curbAnchor: { ...prop.curbAnchor, side: curbSide } } : {}),
    };
    const moving = 'x' in changes || 'z' in changes || 'y' in changes;
    const placement = moving
      ? curbAccessPlacement(network, prop.type, candidate, prop.roadId, context)
      : resolveCurbAccess(network, candidate, context);
    return placement ? anchorCurbAccess(candidate, placement) : null;
  }
  if (!isRoadMarking(prop)) return { ...prop, ...changes };
  const { surfaceLift, ...transform } = changes;
  const candidate = { ...prop, ...transform };
  const moving = 'x' in changes || 'z' in changes || 'y' in changes;
  let placement =
    moving || !prop.roadId
      ? detailPlacement(network, prop.type, candidate, prop.roadId, context)
      : resolveRoadMarking(network, prop, context);
  if (!placement) return null;
  const angle =
    'rotation' in changes
      ? wrapAngle(changes.rotation - placement.rotation)
      : prop.roadAnchor?.angle;
  return anchorRoadMarking(candidate, placement, {
    standard: network.standard,
    angle,
    lift: surfaceLift ?? prop.roadAnchor?.lift ?? 0,
  });
}

/** A single history action reconciles both the road and its paint. Split/cut
 * pieces carry absolute dash phase, which also maps anchors to the right piece
 * without moving a decal to the shortened original road's midpoint.
 */
export function reconcileRoadDetails(next, previous) {
  if (!next.props.some((p) => isRoadAttachedDetail(p) && p.roadId)) return next;
  const ctx = placementContext(next);
  const oldRoads = new Map(previous?.roads.map((r) => [r.id, r]) || []);
  const oldProps = new Map(previous?.props.map((p) => [p.id, p]) || []);
  let changed = false;
  const props = next.props.map((prop) => {
    if (!isRoadAttachedDetail(prop) || !prop.roadId) return prop;
    const old = oldProps.get(prop.id),
      oldRoad = oldRoads.get(prop.roadId);
    let candidate = prop;
    const anchorKey = isCurbAccess(prop) ? 'curbAnchor' : 'roadAnchor',
      anchor = prop[anchorKey];
    if (old === prop && oldRoad && next.roads !== previous.roads && anchor) {
      const pieces = next.roads.filter(
        (r) =>
          r.id === oldRoad.id ||
          r.id.startsWith(`${oldRoad.id}-cut-`) ||
          r.id.startsWith(`${oldRoad.id}-split-`),
      );
      if (pieces.length > 1 && pieces.some((r) => !oldRoads.has(r.id))) {
        const phase = oldRoad.markingPhase || 0;
        const sourceLength = createCurve(oldRoad).getLength();
        const distance = phase + anchor.t * sourceLength;
        const piece = pieces.find((r) => {
          const plan = ctx.topology.plans.get(r.id);
          return (
            plan &&
            distance >= (r.markingPhase || 0) - 0.01 &&
            distance <= (r.markingPhase || 0) + plan.length + 0.01
          );
        });
        if (piece)
          candidate = {
            ...prop,
            roadId: piece.id,
            [anchorKey]: {
              ...anchor,
              t: clamp(
                (distance - (piece.markingPhase || 0)) / ctx.topology.plans.get(piece.id).length,
                0,
                1,
              ),
            },
          };
      }
    }
    const resolved = resolveAttachedDetail(next, candidate, ctx)?.prop;
    if (!resolved) {
      if (candidate !== prop) changed = true;
      return candidate;
    }
    const keys = ['x', 'y', 'z', 'rotation', 'width', 'roadId'];
    if (
      candidate === prop &&
      keys.every((key) => resolved[key] === prop[key]) &&
      JSON.stringify(resolved[anchorKey]) === JSON.stringify(prop[anchorKey]) &&
      resolved.rampDepth === prop.rampDepth
    )
      return prop;
    changed = true;
    return resolved;
  });
  return changed ? { ...next, props } : next;
}
