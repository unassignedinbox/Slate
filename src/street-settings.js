export const PAVING_PATTERNS = [
  "Running bond",
  "Herringbone",
  "Basketweave",
  "Large format",
  "Permeable blocks",
];
export const STREET_DEFAULTS = Object.freeze({
  rampRun: 1.8,
  pedestrianMode: "auto",
  crossingWidth: 3,
  tactile: true,
  drainSpacing: 30,
  manholeSpacing: 70,
  manholeDiameter: 0.7,
});
export function streetSettings(model) {
  return { ...STREET_DEFAULTS, ...model.streets };
}
export function validateStreetSettings(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const bounds = {
    rampRun: [1.2, 2.4],
    crossingWidth: [2.4, 4],
    drainSpacing: [15, 60],
    manholeSpacing: [30, 120],
    manholeDiameter: [0.5, 1],
  };
  return Object.entries(s).every(([k, v]) =>
    k === "pedestrianMode"
      ? ["auto", "perpendicular", "parallel"].includes(v)
      : k === "tactile"
        ? typeof v === "boolean"
        : bounds[k] &&
          Number.isFinite(v) &&
          v >= bounds[k][0] &&
          v <= bounds[k][1],
  );
}

export const DEFAULT_DRIVEWAY = Object.freeze({
  position: 0.5,
  width: 4,
  run: 2,
  side: 1,
});
export function validDriveway(d) {
  return (
    !!d &&
    Number.isFinite(d.position) &&
    d.position >= 0.15 &&
    d.position <= 0.85 &&
    Number.isFinite(d.width) &&
    d.width >= 3 &&
    d.width <= 7 &&
    Number.isFinite(d.run) &&
    d.run >= 1.5 &&
    d.run <= 3 &&
    [-1, 1].includes(d.side)
  );
}
