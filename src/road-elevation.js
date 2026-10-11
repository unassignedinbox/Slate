export const heightOf = (n) => n?.y ?? 0;
export function roadLevels(r, model) {
  return [
    heightOf(model.nodes.find((n) => n.id === r.a)),
    heightOf(model.nodes.find((n) => n.id === r.b)),
  ];
}
export function isElevated(r, model) {
  return roadLevels(r, model).some((y) => y > 0.001);
}
export function landingRun(r, model, end = 0) {
  const length = r.samples?.lengthMeters || 1,
    node = end ? r.b : r.a,
    incident = model.roads.filter((x) => x.a === node || x.b === node),
    width = Math.max(r.width, ...incident.map((x) => x.width));
  return Math.min(length * 0.2, width / 2 + model.radius + 5);
}
export function roadElevation(r, model, s) {
  const [a, b] = roadLevels(r, model);
  if (a === b) return a;
  const length = r.samples.lengthMeters,
    start = landingRun(r, model),
    end = landingRun(r, model, 1),
    t = Math.max(
      0,
      Math.min(1, (s - start) / Math.max(0.01, length - start - end)),
    );
  return a + (b - a) * t * t * (3 - 2 * t);
}
export function liftRoad(model, id, y) {
  const r = model.roads.find((r) => r.id === id);
  if (!r) return;
  for (const n of model.nodes) if (n.id === r.a || n.id === r.b) n.y = y;
}
