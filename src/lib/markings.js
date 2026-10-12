import { isMotorway } from './profiles.js';
import { subtractIntervals } from './infrastructure.js';

export function markingPlan(plan, railSpans = []) {
  const { road, startNode, endNode } = plan;
  const from = plan.startTrim,
    to = plan.length - plan.endTrim;
  const realStart = startNode && !startNode.continuous,
    realEnd = endNode && !endNode.continuous;
  const pedestrian = road.sidewalk > 0 && !isMotorway(road) && road.type !== 'roundabout';
  const zebraStart = pedestrian && startNode?.arms.length >= 3 && to - from > 18;
  const zebraEnd = pedestrian && endNode?.arms.length >= 3 && to - from > 18;
  const blocked = railSpans.map(([a, b]) => [a - 3, b + 3]);
  if (realStart) blocked.push([from, from + (zebraStart ? 8 : 1.5)]);
  if (realEnd) blocked.push([to - (zebraEnd ? 8 : 1.5), to]);
  const allowed = subtractIntervals(from + 0.3, to - 0.3, blocked);
  const fits = (distance, half = 0) =>
    allowed.some(([a, b]) => distance - half >= a && distance + half <= b);
  const zebras = [];
  if (zebraStart && !railSpans.some(([a, b]) => from + 2 >= a - 3 && from + 2 <= b + 3))
    zebras.push({ distance: from + 2, end: 'start', stop: from + 5.5 });
  if (zebraEnd && !railSpans.some(([a, b]) => to - 2 >= a - 3 && to - 2 <= b + 3))
    zebras.push({ distance: to - 2, end: 'end', stop: to - 5.5 });
  return { allowed, zebras, fits, from, to, startNode: realStart, endNode: realEnd };
}

/** Shared safe arc position for authored paint and its paired curb drops. */
export function authoredMarkingDistance(plan, type, requested, railSpans = []) {
  const half = type === 'arrow' ? 2.4 : 1.65;
  const allowed = markingPlan(plan, railSpans).allowed.filter(([a, b]) => b - a >= half * 2 + 0.4);
  if (!allowed.length || plan.carriage < 1.2) return null;
  return allowed
    .map(([a, b]) => Math.max(a + half, Math.min(b - half, requested)))
    .sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested))[0];
}
