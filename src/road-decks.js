import {
  buildNetwork,
  sampleRoad,
  ribbon,
  union,
  offset,
  difference,
  nearestOnSegment,
} from "./network.js";
import { atStation, preparePath, widthProfile } from "./alignment.js";
import {
  heightOf,
  isElevated,
  landingRun,
  roadElevation,
} from "./road-elevation.js";
import { pathOf } from "./streetscape.js";
import { localMesh } from "./local-mesh.js";
import { slabShell } from "./slab-shell.js";
export function roadStationAt(r, x, z) {
  let best = Infinity,
    station = 0;
  for (let i = 1; i < r.samples.length; i++) {
    const p = nearestOnSegment([x, z], r.samples[i - 1], r.samples[i]),
      d = Math.hypot(x - p.point[0], z - p.point[1]);
    if (d < best) {
      best = d;
      station =
        r.samples.stations[i - 1] +
        p.t * (r.samples.stations[i] - r.samples.stations[i - 1]);
    }
  }
  return station;
}
function slice(r, a, b) {
  const pts = [],
    tangents = [],
    widths = [];
  const count = Math.max(1, Math.ceil((b - a) / 0.5));
  for (let i = 0; i <= count; i++) {
    const s = a + ((b - a) * i) / count,
      p = atStation(r.samples, s);
    pts.push([p.x, p.z]);
    tangents.push([p.dx, p.dz]);
    widths.push(
      r.samples.widths[p.index] * (1 - p.t) +
        r.samples.widths[Math.min(p.index + 1, r.samples.length - 1)] * p.t,
    );
  }
  const out = preparePath(pts, tangents);
  out.widths = widths;
  return out;
}
function deck(paths, height, id, kind, surface) {
  const top = localMesh(paths, 0, 2);
  for (let i = 0; i < top.positions.length; i += 3)
    top.positions[i + 1] = height(top.positions[i], top.positions[i + 2]);
  const bottom = {
    positions: top.positions.map((v, i) => (i % 3 === 1 ? v - 0.4 : v)),
    indices: [...top.indices],
    uvs: [...top.uvs],
  };
  return {
    id,
    kind,
    surface,
    paths,
    top,
    shell: slabShell(
      paths,
      height,
      (x, z) => height(x, z) - 0.4,
      0.75,
      top.positions,
      bottom,
    ),
  };
}
// Partition at flat shared junction landings; only incident decks are unioned.
// Unrelated roads directly underneath are deliberately NOT boolean operands.
export function buildElevatedNetwork(model) {
  const sampled = model.roads.map((r) => ({
    ...r,
    samples: sampleRoad(r, model.nodes, model.roads),
  }));
  for (const r of sampled)
    r.samples.widths = r.samples.stations.map((s) =>
      widthProfile(r, model, s, r.samples.lengthMeters),
    );
  const raised = sampled.filter((r) => isElevated(r, model)),
    junctions = [],
    structures = [],
    groundPads = [],
    portals = [],
    groundMask = [];
  for (const n of model.nodes) {
    const incident = sampled.filter((r) => r.a === n.id || r.b === n.id);
    if (!incident.some((r) => isElevated(r, model))) continue;
    const paths = union(
      incident.map((r) => {
        const end = r.b === n.id,
          L = r.samples.lengthMeters,
          run = landingRun(r, model, end ? 1 : 0);
        return pathOf(
          ribbon(slice(r, end ? L - run : 0, end ? L : run), r.width),
        );
      }),
    );
    const shape =
      model.radius > 0
        ? offset(offset(paths, model.radius), -model.radius)
        : paths;
    junctions.push({ id: n.id, paths: shape, y: heightOf(n) });
    if (heightOf(n) > 0.001)
      structures.push(
        deck(
          shape,
          () => 0.12 + heightOf(n),
          n.id,
          "junction",
          incident.every((r) => r.surface === "concrete")
            ? "concrete"
            : "asphalt",
        ),
      );
    else groundPads.push(...shape);
  }
  for (const r of raised) {
    const L = r.samples.lengthMeters,
      paths = difference(
        [pathOf(ribbon(r.samples, r.width))],
        junctions
          .filter((n) => n.id === r.a || n.id === r.b)
          .flatMap((n) => n.paths),
      );
    const height = (x, z) =>
      0.12 + roadElevation(r, model, roadStationAt(r, x, z));
    structures.push(deck(paths, height, r.id, "road", r.surface || "asphalt"));
    for (const end of [0, 1]) {
      const node = model.nodes.find((n) => n.id === (end ? r.b : r.a));
      if (heightOf(node) > 0.001) continue;
      const run = landingRun(r, model, end),
        s = end ? L - run : run,
        p = atStation(r.samples, s),
        half = r.width / 2 + model.sidewalk + 0.5;
      portals.push(
        pathOf(
          [
            [-0.5, -half],
            [0.5, -half],
            [0.5, half],
            [-0.5, half],
          ].map(([u, v]) => [
            p.x + p.dx * u - p.dz * v,
            p.z + p.dz * u + p.dx * v,
          ]),
        ),
      );
      let limit = run;
      while (
        limit < L / 2 &&
        roadElevation(r, model, end ? L - limit : limit) < 0.55
      )
        limit += 0.5;
      groundMask.push(
        pathOf(ribbon(slice(r, end ? L - limit : 0, end ? L : limit), r.width)),
      );
    }
  }
  const groundModel = {
      ...model,
      roads: model.roads.filter((r) => !isElevated(r, model)),
    },
    data = buildNetwork(groundModel, groundPads, model.roads);
  data.curb = difference(data.curb, portals);
  data.walk = difference(data.walk, portals);
  return {
    ...data,
    groundSampled: data.sampled,
    sampled,
    structures,
    junctionDecks: junctions,
    groundMask,
    roadChecks: roadChecks(model, sampled),
    length: sampled.reduce((s, r) => s + r.samples.lengthMeters, 0),
  };
}

// Sampled centreline/envelope proximity checks, not swept-vehicle clearance.
export function roadChecks(model, sampled) {
  const pairs = new Map();
  for (const r of sampled.filter((r) => isElevated(r, model))) {
    const L = r.samples.lengthMeters;
    const others = sampled.filter(
      (o) => o.id !== r.id && ![r.a, r.b].some((n) => n === o.a || n === o.b),
    );
    for (let s = 0; s <= L; s += 2) {
      const p = atStation(r.samples, s),
        y = roadElevation(r, model, s);
      for (const o of others) {
        const station = roadStationAt(o, p.x, p.z),
          q = atStation(o.samples, station);
        if (Math.hypot(p.x - q.x, p.z - q.z) > (r.width + o.width) / 2)
          continue;
        const clearance = Math.abs(y - roadElevation(o, model, station)) - 0.4,
          key = [r.id, o.id].sort().join(":");
        if (!pairs.has(key) || clearance < pairs.get(key).clearance)
          pairs.set(key, { roads: [r.id, o.id], clearance });
      }
    }
  }
  return [...pairs.values()];
}
