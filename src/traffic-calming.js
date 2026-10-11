import { atStation, sampleRoad } from "./alignment.js";
export const DEFAULT_HUMP = Object.freeze({
  position: 0.5,
  length: 3.7,
  height: 0.075,
});
export function validHump(h) {
  return (
    h &&
    Number.isFinite(h.position) &&
    h.position >= 0.15 &&
    h.position <= 0.85 &&
    Number.isFinite(h.length) &&
    h.length >= 2.5 &&
    h.length <= 5 &&
    Number.isFinite(h.height) &&
    h.height >= 0.05 &&
    h.height <= 0.12
  );
}
export function humpSpec(road, model) {
  if (!road.speedHump || model.layers.calming === false) return null;
  const path = road.samples || sampleRoad(road, model.nodes, model.roads),
    length = path.lengthMeters;
  const config = road.speedHump,
    clearance = Math.max(12, road.width / 2 + model.radius + 5),
    half = config.length / 2;
  if (length < 2 * (clearance + half)) return null;
  const center = Math.max(
    clearance + half,
    Math.min(length - clearance - half, length * config.position),
  );
  return { ...config, center, width: road.width - 0.5, path };
}
export function humpHeight(s, h) {
  const u = (s - h.center) / h.length;
  if (Math.abs(u) >= 0.5) return 0;
  return h.height * 0.5 * (1 + Math.cos(2 * Math.PI * u));
}
export function humpMesh(road, model) {
  const h = humpSpec(road, model);
  if (!h) return null;
  const positions = [],
    indices = [],
    uvs = [],
    paintPositions = [],
    paintIndices = [];
  function point(s, lift, lateral) {
    const p = atStation(h.path, s);
    const edge = Math.max(
      0,
      Math.min(1, (h.width / 2 - Math.abs(lateral)) / 0.3),
    );
    const feather = edge * edge * (3 - 2 * edge);
    return [
      p.x - p.dz * lateral,
      0.12 + humpHeight(s, h) * feather + lift,
      p.z + p.dx * lateral,
    ];
  }
  const rows = 64,
    cols = 24;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const s = h.center - h.length / 2 + (h.length * j) / rows,
        lateral = (i / cols - 0.5) * h.width;
      positions.push(...point(s, 0, lateral));
      uvs.push(lateral / 5, s / 5);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i,
        b = a + cols + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // White approach chevrons conform to the raised cosine profile, not floating
  // planar decal cards. Mark both travel directions on their respective lanes.
  for (const dir of [-1, 1])
    for (const side of [-1, 1]) {
      const base = paintPositions.length / 3;
      for (let j = 0; j <= 24; j++) {
        const t = j / 24,
          s = h.center + dir * (-h.length * 0.32 + t * h.length * 0.44),
          lateral = (dir * road.width) / 4 + side * (1 - t) * 0.85;
        for (const off of [-0.065, 0.065])
          paintPositions.push(...point(s, 0.006, lateral + off));
      }
      for (let j = 0; j < 24; j++) {
        const a = base + j * 2;
        if (dir > 0) paintIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else paintIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  return { spec: h, positions, indices, uvs, paintPositions, paintIndices };
}
