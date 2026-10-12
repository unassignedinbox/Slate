import { Vector3 } from 'three';
import { createCurve, frameAt } from './curves.js';
import { roadWidth, carriageWidth, isRail } from './profiles.js';

export const SURFACE_Y = 0.1;
export const PAVING_Y = 0.28;
export const PAINT_Y = 0.105;
export const endpointKey = (p) =>
  p.nodeId || `${p.x.toFixed(2)},${p.z.toFixed(2)},${(p.y || 0).toFixed(2)}`;
const right = (t) => new Vector3(-t.z, 0, t.x).normalize();
const cross = (a, b) => a.x * b.z - a.z * b.x;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const flat = (v) => new Vector3(v.x, 0, v.z).normalize();

function returnPath(a, b, node, outer) {
  const pa = a.center.clone().addScaledVector(a.outNormal, (outer ? a.width : a.carriage) / 2);
  const pb = b.center.clone().addScaledVector(b.outNormal, -(outer ? b.width : b.carriage) / 2);
  const delta = pb.clone().sub(pa),
    den = cross(a.outTangent, b.outTangent);
  const gap = (b.angle - a.angle + Math.PI * 2) % (Math.PI * 2);
  let controls;
  if (Math.abs(den) > 0.0001) {
    const ta = cross(delta, b.outTangent) / den,
      tb = cross(delta, a.outTangent) / den;
    const c = pa.clone().addScaledVector(a.outTangent, ta);
    c.y = (pa.y + pb.y) / 2;
    const limit = Math.max(dist(a.center, node), dist(b.center, node), a.width, b.width) * 2.5;
    if (ta < -0.001 && tb < -0.001 && dist(c, node) < limit) {
      const r = Math.min(
        gap > Math.PI + 0.1 ? Math.max(a.carriage, b.carriage) / 2 : 2.5,
        -ta * 0.45,
        -tb * 0.45,
      );
      const entry = c.clone().addScaledVector(a.outTangent, r);
      const exit = c.clone().addScaledVector(b.outTangent, r);
      entry.y = pa.y + (c.y - pa.y) * (1 - r / -ta);
      exit.y = pb.y + (c.y - pb.y) * (1 - r / -tb);
      controls = { c, entry, exit };
    }
  }
  // Exactly nine stations on both inner and outer returns. This lets pavement
  // be a true ring of strips, including arms with no sidewalk, not a filled
  // polygon floating underneath/above the carriageway.
  if (!controls) return Array.from({ length: 9 }, (_, i) => pa.clone().lerp(pb, i / 8));
  const { c, entry, exit } = controls;
  return [
    pa,
    entry,
    ...Array.from({ length: 5 }, (_, i) => {
      const t = (i + 1) / 6;
      return entry
        .clone()
        .multiplyScalar((1 - t) ** 2)
        .addScaledVector(c, 2 * t * (1 - t))
        .addScaledVector(exit, t * t);
    }),
    exit,
    pb,
  ];
}

export function samplesBetween(
  plan,
  from = plan.startTrim,
  to = plan.length - plan.endTrim,
  spacing = plan.spacing || 2.5,
) {
  from = Math.max(plan.startTrim || 0, from);
  to = Math.min(plan.length - (plan.endTrim || 0), to);
  if (to - from < 0.001) return [];
  const n = Math.max(1, Math.min(700, Math.ceil((to - from) / spacing)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const d = from + ((to - from) * i) / n;
    const s = frameAt(plan.curve, d, plan.length);
    if (i === 0 && Math.abs(d - plan.startTrim) < 0.00001 && plan.startCap) {
      s.point.copy(plan.startCap.point);
      s.normal.copy(plan.startCap.normal);
    }
    if (i === n && Math.abs(d - (plan.length - plan.endTrim)) < 0.00001 && plan.endCap) {
      s.point.copy(plan.endCap.point);
      s.normal.copy(plan.endCap.normal);
    }
    return s;
  });
}

/** One source of truth for trimmed road sections AND their junction portals. */
export function buildTopology(network, { includeHidden = false } = {}) {
  const roads = network.roads.filter((r) => !isRail(r) && (includeHidden || !r.hidden));
  const plans = new Map(
    roads.map((road) => {
      const curve = createCurve(road);
      return [
        road.id,
        {
          road,
          curve,
          length: curve.getLength(),
          startTrim: 0,
          endTrim: 0,
          width: roadWidth(road),
          carriage: carriageWidth(road),
          spacing: ['bridge', 'ramp'].includes(road.type) ? 1 : 2.5,
        },
      ];
    }),
  );
  const nodes = new Map(),
    warnings = [];
  for (const road of roads.filter((r) => r.type !== 'path'))
    for (const start of [true, false]) {
      const p = start ? road.points[0] : road.points.at(-1),
        id = endpointKey(p),
        plan = plans.get(road.id);
      if (!nodes.has(id)) nodes.set(id, { id, x: p.x, z: p.z, y: p.y || 0, arms: [] });
      const tangent = plan.curve.getTangentAt(start ? 0 : 1).multiplyScalar(start ? 1 : -1);
      nodes.get(id).arms.push({
        plan,
        road,
        start,
        outTangent: flat(tangent),
        width: plan.width,
        carriage: plan.carriage,
        trim: 0,
      });
    }
  for (const node of nodes.values()) {
    if (node.arms.length < 2) continue;
    const arms = node.arms;
    node.continuous =
      arms.length === 2 &&
      arms[0].outTangent.dot(arms[1].outTangent) < -0.96 &&
      Math.abs(arms[0].width - arms[1].width) < 0.001 &&
      Math.abs(arms[0].carriage - arms[1].carriage) < 0.001;
    if (node.continuous) {
      const tangent = arms[0].outTangent.clone().sub(arms[1].outTangent).normalize();
      const common = right(tangent);
      const scale = 1 / Math.max(0.85, common.dot(right(arms[0].outTangent)));
      arms.forEach((arm, i) => {
        const normal = common
          .clone()
          .multiplyScalar((i === 0 ? 1 : -1) * (arm.start ? 1 : -1) * scale);
        arm.plan[arm.start ? 'startCap' : 'endCap'] = {
          point: new Vector3(node.x, node.y, node.z),
          normal,
        };
        arm.plan[arm.start ? 'startNode' : 'endNode'] = node;
      });
      continue;
    }
    for (const arm of arms) {
      let trim = 2.5;
      for (const other of arms) {
        if (arm === other) continue;
        const cosine = Math.max(-1, Math.min(1, arm.outTangent.dot(other.outTangent)));
        const angle = Math.acos(cosine),
          sine = Math.sin(angle);
        if (angle > 0.35 && angle < Math.PI - 0.15)
          trim = Math.max(trim, (other.carriage / 2 + (arm.carriage / 2) * cosine) / sine + 3);
      }
      arm.trim = Math.min(arm.plan.length * 0.44, trim);
    }
    // Parallel exits/merges need room for the curved branch to separate from
    // the mainline. The old tangent/chord based hulls cannot represent these.
    for (let i = 0; i < arms.length; i++)
      for (let j = i + 1; j < arms.length; j++) {
        const a = arms[i],
          b = arms[j];
        if (a.outTangent.dot(b.outTangent) < 0.82) continue;
        const max = Math.min(a.plan.length, b.plan.length) * 0.44;
        let d = Math.max(a.trim, b.trim, 6);
        const at = (arm, distance) =>
          arm.plan.curve.getPointAt(
            arm.start ? distance / arm.plan.length : 1 - distance / arm.plan.length,
          );
        while (d < max && dist(at(a, d), at(b, d)) < (a.carriage + b.carriage) / 2 + 2.5) d += 2;
        a.trim = Math.max(a.trim, Math.min(max, d));
        b.trim = Math.max(b.trim, Math.min(max, d));
      }
    for (const arm of arms) {
      arm.plan[arm.start ? 'startTrim' : 'endTrim'] = arm.trim;
      arm.plan[arm.start ? 'startNode' : 'endNode'] = node;
    }
  }
  for (const plan of plans.values()) {
    const total = plan.startTrim + plan.endTrim;
    if (total > plan.length * 0.8) {
      const scale = (plan.length * 0.8) / total;
      plan.startTrim *= scale;
      plan.endTrim *= scale;
      warnings.push({
        roadId: plan.road.id,
        message: 'Short segment: junction transitions consume most of its length.',
      });
    }
    plan.samples = samplesBetween(plan);
  }
  const junctions = [];
  for (const node of nodes.values()) {
    if (node.arms.length < 2 || node.continuous) continue;
    for (const arm of node.arms) {
      const samples = arm.plan.samples,
        s = arm.start ? samples[0] : samples.at(-1);
      arm.center = s.point.clone();
      arm.outTangent = flat(s.tangent).multiplyScalar(arm.start ? 1 : -1);
      arm.outNormal = s.normal.clone().multiplyScalar(arm.start ? 1 : -1);
      arm.angle = Math.atan2(arm.center.z - node.z, arm.center.x - node.x);
    }
    node.arms.sort((a, b) => a.angle - b.angle);
    node.returns = node.arms.map((a, i) => {
      const b = node.arms[(i + 1) % node.arms.length];
      return { inner: returnPath(a, b, node, false), outer: returnPath(a, b, node, true), a, b };
    });
    node.boundary = node.arms.flatMap((arm, i) => [
      arm.center.clone().addScaledVector(arm.outNormal, -arm.carriage / 2),
      arm.center.clone().addScaledVector(arm.outNormal, arm.carriage / 2),
      ...node.returns[i].inner.slice(1, -1),
    ]);
    junctions.push(node);
  }
  return { plans, junctions, nodes, warnings };
}
