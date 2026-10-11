import { buildElevatedNetwork } from "./road-decks.js";
import { roadElevation, heightOf, isElevated } from "./road-elevation.js";
import ClipperLib from "clipper-lib";
import earcut from "earcut";
import {
  PAVING_PATTERNS,
  STREET_DEFAULTS,
  validateStreetSettings,
  validDriveway,
} from "./street-settings.js";
import { validHump } from "./traffic-calming.js";
const SCALE = 1000;
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export { sampleRoad } from "./alignment.js";
import { sampleRoad, widthProfile } from "./alignment.js";
export function ribbon(points, width) {
  return points
    .map((p, i) => {
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)],
        d = distance(a, b) || 1;
      return [
        p[0] -
          ((points.tangents?.[i]?.[1] ?? (b[1] - a[1]) / d) *
            (points.widths?.[i] ?? width)) /
            2,
        p[1] +
          ((points.tangents?.[i]?.[0] ?? (b[0] - a[0]) / d) *
            (points.widths?.[i] ?? width)) /
            2,
      ];
    })
    .concat(
      points
        .map((p, i) => {
          const a = points[Math.max(0, i - 1)],
            b = points[Math.min(points.length - 1, i + 1)],
            d = distance(a, b) || 1;
          return [
            p[0] +
              ((points.tangents?.[i]?.[1] ?? (b[1] - a[1]) / d) *
                (points.widths?.[i] ?? width)) /
                2,
            p[1] -
              ((points.tangents?.[i]?.[0] ?? (b[0] - a[0]) / d) *
                (points.widths?.[i] ?? width)) /
                2,
          ];
        })
        .reverse(),
    );
}
const toPath = (p) =>
  p.map((v) => ({ X: Math.round(v[0] * SCALE), Y: Math.round(v[1] * SCALE) }));
export const fromPath = (p) => p.map((v) => [v.X / SCALE, v.Y / SCALE]);
export function union(paths) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const result = [];
  c.Execute(
    ClipperLib.ClipType.ctUnion,
    result,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return result;
}
export function offset(paths, delta) {
  const c = new ClipperLib.ClipperOffset(2, 5);
  c.AddPaths(
    paths,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );
  const out = [];
  c.Execute(out, delta * SCALE);
  return ClipperLib.Clipper.CleanPolygons(out, 1);
}
export function difference(a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  const out = [];
  c.Execute(
    ClipperLib.ClipType.ctDifference,
    out,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return ClipperLib.Clipper.CleanPolygons(out, 1);
}
export function intersectionPaths(a, b) {
  if (!a.length || !b.length) return [];
  const c = new ClipperLib.Clipper(),
    out = [];
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  c.Execute(
    ClipperLib.ClipType.ctIntersection,
    out,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return out;
}
export function triangulate(paths, y = 0) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  const positions = [],
    indices = [],
    uvs = [];
  function visit(node) {
    if (node.Contour().length && !node.IsHole()) {
      const rings = [
          node.Contour(),
          ...node
            .Childs()
            .filter((n) => n.IsHole())
            .map((n) => n.Contour()),
        ],
        flat = [],
        holes = [];
      rings.forEach((r, i) => {
        if (i) holes.push(flat.length / 2);
        r.forEach((p) => flat.push(p.X / SCALE, p.Y / SCALE));
      });
      const base = positions.length / 3;
      for (let i = 0; i < flat.length; i += 2) {
        positions.push(flat[i], y, flat[i + 1]);
        uvs.push(flat[i] / 5, flat[i + 1] / 5);
      }
      const ids = earcut(flat, holes);
      for (let i = 0; i < ids.length; i += 3) {
        const a = ids[i],
          b = ids[i + 1],
          d = ids[i + 2];
        const cross =
          (flat[b * 2] - flat[a * 2]) * (flat[d * 2 + 1] - flat[a * 2 + 1]) -
          (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[d * 2] - flat[a * 2]);
        if (Math.abs(cross) < 1e-9) continue;
        indices.push(
          base + a,
          base + (cross > 0 ? d : b),
          base + (cross > 0 ? b : d),
        );
      }
    }
    node.Childs().forEach(visit);
  }
  visit(tree);
  return { positions, indices, uvs };
}
export function buildNetwork(
  model,
  extraSurface = [],
  alignmentRoads = model.roads,
) {
  if (model.roads.some((r) => isElevated(r, model)))
    return buildElevatedNetwork(model);
  const sampled = model.roads.map((r) => ({
    ...r,
    samples: sampleRoad(r, model.nodes, alignmentRoads),
  }));
  sampled.forEach((r) => {
    r.samples.widths = r.samples.stations.map((s) =>
      widthProfile(
        r,
        { ...model, roads: alignmentRoads },
        s,
        r.samples.lengthMeters,
      ),
    );
  });
  const raw = union([
    ...extraSurface,
    ...sampled.map((r) => {
      const p = ClipperLib.Clipper.CleanPolygon(
        toPath(ribbon(r.samples, r.width)),
        1,
      );
      if (!ClipperLib.Clipper.Orientation(p)) p.reverse();
      return p;
    }),
  ]);
  // Morphological closing fills concave junction corners without layered road faces.
  const surface =
    model.radius > 0 ? offset(offset(raw, model.radius), -model.radius) : raw;
  const curbOuter = offset(surface, 0.22),
    baseWalkOuter = offset(surface, model.sidewalk + 0.22),
    walkwayPaths = [],
    connectionWarnings = [];
  if (model.layers.walkways !== false)
    for (const link of model.connections || []) {
      if (link.kind !== "walkway") continue;
      const footprint = toPath(ribbon(link.points, link.width));
      if (!ClipperLib.Clipper.Orientation(footprint)) footprint.reverse();
      const overlaps = intersectionPaths([footprint], surface);
      if (overlaps.some((p) => Math.abs(ClipperLib.Clipper.Area(p)) > 10000)) {
        connectionWarnings.push({
          id: link.id,
          message:
            "Walkway crosses the carriageway. End at the sidewalk, or use a bridge.",
        });
        continue;
      }
      walkwayPaths.push(footprint);
    }
  const walkOuter = union([...baseWalkOuter, ...walkwayPaths]);
  const concreteRaw = union(
    sampled
      .filter((r) => r.surface === "concrete")
      .map((r) => {
        const p = toPath(ribbon(r.samples, r.width));
        if (!ClipperLib.Clipper.Orientation(p)) p.reverse();
        return p;
      }),
  );
  const asphaltRaw = union(
    sampled
      .filter((r) => r.surface !== "concrete")
      .map((r) => {
        const p = toPath(ribbon(r.samples, r.width));
        if (!ClipperLib.Clipper.Orientation(p)) p.reverse();
        return p;
      }),
  );
  const concreteSurface = intersectionPaths(
    surface,
    difference(concreteRaw, asphaltRaw),
  );
  return {
    sampled,
    surface,
    concreteSurface,
    connectionWarnings,
    walkwayPaths,
    baseWalkOuter,
    curb: difference(curbOuter, surface),
    walk: difference(walkOuter, curbOuter),
    walkOuter,
    mesh: triangulate(surface, 0.12),
    length: sampled.reduce(
      (sum, r) =>
        sum +
        r.samples
          .slice(1)
          .reduce((s, p, i) => s + distance(p, r.samples[i]), 0),
      0,
    ),
  };
}
export function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1),
      ),
    );
  const q = [a[0] + t * dx, a[1] + t * dz];
  return { point: q, t, distance: distance(p, q) };
}
export function nearestRoad(point, model) {
  let best = null;
  for (const road of model.roads) {
    const p = road.samples || sampleRoad(road, model.nodes, model.roads);
    for (let i = 1; i < p.length; i++) {
      const hit = nearestOnSegment(point, p[i - 1], p[i]);
      if (!best || hit.distance < best.distance) best = { ...hit, road };
    }
  }
  return best;
}
export function preset(kind = "district") {
  if (kind === "bridges") {
    const m = preset("empty");
    m.name = "One network · bridge district";
    m.nodes = [];
    m.roads = [];
    m.connections = [];
    m.traffic = 18;
    const node = (x, z, y = 0) => {
      let n = m.nodes.find((n) => n.x === x && n.z === z && heightOf(n) === y);
      if (!n) {
        n = { id: `bnode${m.nodes.length}`, x, z, y };
        m.nodes.push(n);
      }
      return n.id;
    };
    const road = (a, b, name, control) =>
      m.roads.push({
        id: `broad${m.roads.length}`,
        a: node(...a),
        b: node(...b),
        width: 10,
        name,
        control,
      });
    const xs = [-250, -125, 0, 125, 250],
      zs = [-130, 0, 130];
    for (const z of zs)
      for (let i = 1; i < xs.length; i++)
        road([xs[i - 1], z], [xs[i], z], "Ground boulevard");
    for (const x of xs) {
      const levels = Math.abs(x) === 250 ? [-130, 0, 45, 130] : zs;
      for (let i = 1; i < levels.length; i++)
        road([x, levels[i - 1]], [x, levels[i]], "Ground avenue");
    }
    road([-250, 45], [-100, 45, 6], "West rising approach", [-175, 65]);
    road([-100, 45, 6], [0, 45, 6], "West bridge span");
    road([0, 45, 6], [100, 45, 6], "East bridge span");
    road([100, 45, 6], [250, 45], "East descending approach", [175, 65]);
    road([0, -280], [0, -100, 6], "North rising approach", [-20, -190]);
    road([0, -100, 6], [0, 45, 6], "North bridge span");
    road([0, 45, 6], [0, 140, 6], "South bridge span");
    road([0, 140, 6], [0, 310], "South descending approach", [20, 225]);
    road([-125, -130], [-125, -280], "North local link");
    road([-125, -280], [0, -280], "North landing link");
    road([125, 130], [125, 310], "South local link");
    road([125, 310], [0, 310], "South landing link");
    reconcileIntersections(m);
    return m;
  }
  if (kind === "parks") {
    const m = preset("junction");
    m.name = "Park connections";
    m.nodes = [
      { id: "pa", x: 0, z: -110 },
      { id: "pb", x: 0, z: 45 },
      { id: "pc", x: 0, z: 110 },
      { id: "pd", x: 95, z: 45 },
    ];
    m.roads = [
      { id: "pr1", a: "pa", b: "pb", width: 12 },
      { id: "pr2", a: "pb", b: "pc", width: 12 },
      {
        id: "pr3",
        a: "pb",
        b: "pd",
        width: 5,
        surface: "concrete",
        name: "Concrete park access",
      },
    ];
    const westArc = Array.from({ length: 65 }, (_, i) => {
      const a = -Math.PI / 2 - (Math.PI * i) / 64;
      return [-95 + 22.5 * Math.cos(a), -32.5 + 22.5 * Math.sin(a)];
    });
    const westWalk = [[-8.47, -55], ...westArc, [-88, -10]],
      eastWalk = westWalk.map((p) => [-p[0], p[1]]).reverse();
    m.connections = [
      {
        id: "park-bridge",
        kind: "bridge",
        width: 4.5,
        height: 5.5,
        points: [
          [-88, -10],
          [0, -10],
          [88, -10],
        ],
      },
      {
        id: "park-west-walk",
        kind: "walkway",
        width: 3,
        points: westWalk,
      },
      {
        id: "park-east-walk",
        kind: "walkway",
        width: 3,
        points: eastWalk,
      },
    ];
    m.traffic = 6;
    return m;
  }
  const nodes = [],
    roads = [];
  let id = 0;
  const node = (x, z) => {
    const n = { id: `n${nodes.length}`, x, z };
    nodes.push(n);
    return n.id;
  };
  const road = (a, b, width = 10, control) =>
    roads.push({
      id: `r${id++}`,
      name: `Road ${String(id).padStart(2, "0")}`,
      a,
      b,
      width,
      control,
    });
  if (kind === "junction") {
    const c = node(0, 0);
    [
      [-85, 0],
      [80, 0],
      [0, -75],
      [0, 75],
    ].forEach((p) => road(c, node(...p), 12));
  } else if (kind === "fork") {
    const c = node(0, 0);
    road(node(-80, 55), c, 10, [-30, 38]);
    road(c, node(-65, -65), 10, [-14, -32]);
    road(c, node(80, -35), 10, [35, -30]);
  } else {
    const grid = [];
    const xs = [-112, -38, 42, 117],
      zs = [-92, -20, 64];
    for (let j = 0; j < 3; j++) {
      grid[j] = [];
      for (let i = 0; i < 4; i++)
        grid[j][i] = node(
          xs[i] + (j === 2 ? 12 : 0),
          zs[j] + (i === 3 ? 14 : 0),
        );
    }
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++)
        road(
          grid[j][i],
          grid[j][i + 1],
          j === 1 ? 14 : 9,
          j === 2 ? [(xs[i] + xs[i + 1]) / 2 + 10, 81] : undefined,
        );
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++)
        road(
          grid[j][i],
          grid[j + 1][i],
          i === 1 ? 12 : 9,
          i === 3 ? [143, (zs[j] + zs[j + 1]) / 2] : undefined,
        );
    road(node(-160, -20), grid[1][0], 14);
    road(grid[1][3], node(175, 10), 14, [160, -8]);
    road(node(-38, -142), grid[0][1], 12);
    road(grid[2][1], node(-12, 119), 12);
  }
  return {
    version: 1,
    connections: [],
    name:
      kind === "district"
        ? "Westhaven district"
        : kind === "fork"
          ? "Three-way junction"
          : "Four-way junction",
    nodes,
    roads,
    radius: 5,
    sidewalk: 2.4,
    traffic: 12,
    speed: 30,
    layers: {
      roads: true,
      markings: true,
      sidewalks: true,
      curbs: true,
      landscape: true,
      lights: true,
      bollards: false,
      traffic: true,
      calming: true,
      crossings: true,
      ramps: true,
      drainage: true,
      manholes: true,
      driveways: true,
      walkways: true,
      bridges: true,
    },
    materials: {
      asphalt: "#4c5357",
      roughness: 0.94,
      wear: 0.28,
      paving: "Herringbone",
      pavingScale: 1,
      pavingRotation: 0,
      pavingColor: "#c9c5ba",
    },
    streets: { ...STREET_DEFAULTS },
    seed: 42,
  };
}
export function snapRoadDrawingPoint(model, point, elevation) {
  let best = null;
  for (const raw of model.roads) {
    const r = { ...raw, samples: sampleRoad(raw, model.nodes, model.roads) };
    for (let i = 1; i < r.samples.length; i++) {
      const hit = nearestOnSegment(point, r.samples[i - 1], r.samples[i]);
      if (
        hit.distance > r.width / 2 + 2 ||
        (best && hit.distance >= best.distance)
      )
        continue;
      const s =
          r.samples.stations[i - 1] +
          hit.t * (r.samples.stations[i] - r.samples.stations[i - 1]),
        y = roadElevation(r, model, s);
      if (Math.abs(y - elevation) < 0.25) best = { ...hit, y };
    }
  }
  return best ? [...best.point, best.y] : [...point, elevation];
}
export function addCurve(model, points, width = 10, attributes = {}) {
  const elevation = attributes.elevation ?? 0;
  const find = (p, elevation) => {
    let n = model.nodes.find(
      (n) =>
        distance([n.x, n.z], p) < 0.6 &&
        Math.abs(heightOf(n) - elevation) < 0.02,
    );
    if (!n) {
      n = { id: crypto.randomUUID(), x: p[0], z: p[1], y: elevation };
      model.nodes.push(n);
    }
    return n.id;
  };
  const { elevation: unused, levels, ...rest } = attributes;
  const road = {
    ...rest,
    id: crypto.randomUUID(),
    name: attributes.name || "Drawn road",
    width,
    a: find(points[0], levels?.[0] ?? elevation),
    b: find(points.at(-1), levels?.[1] ?? elevation),
    points: points.slice(1, -1),
  };
  model.roads.push(road);
  const changed = reconcileIntersections(model);
  return changed.length
    ? [
        ...changed.filter((r) => r.id !== road.id),
        ...model.roads.filter((r) => r.id === road.id),
      ]
    : [road];
}
// Reconcile actual 3D centreline crossings. A bridge crossing a lower road is
// not a junction. Shared vertices, rather than stacked surfaces, define joins.
export function reconcileIntersections(model) {
  // Moving/lowering an endpoint onto another endpoint welds their graph IDs.
  const canonical = [];
  for (const n of model.nodes) {
    const other = canonical.find(
      (v) =>
        distance([v.x, v.z], [n.x, n.z]) < 0.02 &&
        Math.abs(heightOf(v) - heightOf(n)) < 0.02,
    );
    if (other) {
      for (const r of model.roads) {
        if (r.a === n.id) r.a = other.id;
        if (r.b === n.id) r.b = other.id;
      }
    } else canonical.push(n);
  }
  model.nodes = canonical;
  model.roads = model.roads.filter((r) => r.a !== r.b);
  const created = [];
  const findNode = (p, y) => {
    let n = model.nodes.find(
      (n) => distance([n.x, n.z], p) < 0.02 && Math.abs(heightOf(n) - y) < 0.02,
    );
    if (!n) {
      n = { id: crypto.randomUUID(), x: p[0], z: p[1], y };
      model.nodes.push(n);
    }
    return n.id;
  };
  const entries = model.roads.map((r) => {
    const samples = sampleRoad(r, model.nodes, model.roads),
      road = { ...r, samples };
    return {
      r,
      road,
      samples,
      cuts: [
        {
          s: 0,
          p: samples[0],
          y: heightOf(model.nodes.find((n) => n.id === r.a)),
        },
        {
          s: samples.length - 1,
          p: samples.at(-1),
          y: heightOf(model.nodes.find((n) => n.id === r.b)),
        },
      ],
    };
  });
  for (let a = 0; a < entries.length; a++)
    for (let b = a + 1; b < entries.length; b++) {
      const A = entries[a],
        B = entries[b];
      const bounds = (e) =>
        (e.bounds ??= [
          Math.min(...e.samples.map((p) => p[0])),
          Math.min(...e.samples.map((p) => p[1])),
          Math.max(...e.samples.map((p) => p[0])),
          Math.max(...e.samples.map((p) => p[1])),
        ]);
      const ba = bounds(A),
        bb = bounds(B);
      if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1])
        continue;
      for (let i = 0; i < A.samples.length - 1; i++)
        for (let j = 0; j < B.samples.length - 1; j++) {
          const p = A.samples[i],
            q = A.samples[i + 1],
            c = B.samples[j],
            d = B.samples[j + 1];
          if (
            Math.max(p[0], q[0]) < Math.min(c[0], d[0]) ||
            Math.max(c[0], d[0]) < Math.min(p[0], q[0]) ||
            Math.max(p[1], q[1]) < Math.min(c[1], d[1]) ||
            Math.max(c[1], d[1]) < Math.min(p[1], q[1])
          )
            continue;
          const vx = q[0] - p[0],
            vz = q[1] - p[1],
            wx = d[0] - c[0],
            wz = d[1] - c[1],
            det = vx * wz - vz * wx;
          if (Math.abs(det) < 1e-8) {
            for (const [first, second, k, l] of [
              [A, B, i, j],
              [B, A, j, i],
            ])
              for (const end of [0, first.samples.length - 1]) {
                if (end !== k && end !== k + 1) continue;
                const p = first.samples[end],
                  hit = nearestOnSegment(
                    p,
                    second.samples[l],
                    second.samples[l + 1],
                  ),
                  s = l + hit.t;
                if (
                  hit.distance > 0.002 ||
                  s < 1e-5 ||
                  s > second.samples.length - 1 - 1e-5
                )
                  continue;
                const y = roadElevation(
                    first.road,
                    model,
                    first.samples.stations[end],
                  ),
                  other = roadElevation(
                    second.road,
                    model,
                    second.samples.stations[l] +
                      hit.t *
                        (second.samples.stations[l + 1] -
                          second.samples.stations[l]),
                  );
                if (Math.abs(y - other) < 0.02) second.cuts.push({ s, p, y });
              }
            continue;
          }
          let t = ((c[0] - p[0]) * wz - (c[1] - p[1]) * wx) / det,
            u = ((c[0] - p[0]) * vz - (c[1] - p[1]) * vx) / det;
          if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) continue;
          t = Math.max(0, Math.min(1, t));
          u = Math.max(0, Math.min(1, u));
          const ya = roadElevation(
              A.road,
              model,
              A.samples.stations[i] +
                t * (A.samples.stations[i + 1] - A.samples.stations[i]),
            ),
            yb = roadElevation(
              B.road,
              model,
              B.samples.stations[j] +
                u * (B.samples.stations[j + 1] - B.samples.stations[j]),
            );
          if (Math.abs(ya - yb) > 0.02) continue;
          const point = [p[0] + t * vx, p[1] + t * vz],
            y = (ya + yb) / 2;
          if (i + t > 1e-5 && i + t < A.samples.length - 1 - 1e-5)
            A.cuts.push({ s: i + t, p: point, y });
          if (j + u > 1e-5 && j + u < B.samples.length - 1 - 1e-5)
            B.cuts.push({ s: j + u, p: point, y });
        }
    }
  function split(samples, breaks, base) {
    breaks.sort((a, b) => a.s - b.s);
    breaks = breaks.filter((c, i) => !i || c.s - breaks[i - 1].s > 1e-5);
    const meters = [0];
    for (let i = 1; i < samples.length; i++)
      meters.push(meters[i - 1] + distance(samples[i - 1], samples[i]));
    const metersAt = (s) => {
      const i = Math.min(Math.floor(s), samples.length - 2);
      return meters[i] + (s - i) * (meters[i + 1] - meters[i]);
    };
    for (let i = 1; i < breaks.length; i++) {
      const a = breaks[i - 1],
        b = breaks[i];
      if (distance(a.p, b.p) < 0.3) continue;
      const station = base.speedHump?.position * (samples.length - 1);
      const speedHump =
        base.speedHump && station >= a.s && station < b.s
          ? {
              ...base.speedHump,
              position: Math.max(
                0.15,
                Math.min(0.85, (station - a.s) / (b.s - a.s)),
              ),
            }
          : undefined;
      const dStation = base.driveway?.position * meters.at(-1),
        startMeters = metersAt(a.s),
        endMeters = metersAt(b.s);
      const driveway =
        base.driveway && dStation >= startMeters && dStation < endMeters
          ? {
              ...base.driveway,
              position: Math.max(
                0.15,
                Math.min(
                  0.85,
                  (dStation - startMeters) / (endMeters - startMeters),
                ),
              ),
            }
          : undefined;
      created.push({
        ...base,
        driveway,
        speedHump,
        id: i === 1 ? base.id : crypto.randomUUID(),
        a: findNode(a.p, a.y),
        b: findNode(b.p, b.y),
        control: undefined,
        points: samples.slice(Math.floor(a.s) + 1, Math.ceil(b.s)),
      });
    }
  }

  const replacements = entries.filter((e) => e.cuts.length > 2);
  for (const e of replacements) split(e.samples, e.cuts, e.r);
  model.roads = model.roads.filter(
    (r) => !replacements.some((e) => e.r.id === r.id),
  );
  model.roads.push(...created);
  const unique = [];
  for (const r of model.roads) {
    const duplicate = unique.find((q) => {
      if (!((r.a === q.a && r.b === q.b) || (r.a === q.b && r.b === q.a)))
        return false;
      const a = sampleRoad(r, model.nodes, model.roads),
        b = sampleRoad(q, model.nodes, model.roads);
      return a.every((p) =>
        b.some((q, i) => i && nearestOnSegment(p, b[i - 1], q).distance < 0.02),
      );
    });
    if (duplicate) duplicate.width = Math.max(duplicate.width, r.width);
    else unique.push(r);
  }
  model.roads = unique;
  return created.filter((r) => unique.includes(r));
}
export function validateModel(m) {
  if (
    !m ||
    m.version !== 1 ||
    !Array.isArray(m.nodes) ||
    !Array.isArray(m.roads) ||
    m.nodes.length > 2000 ||
    m.roads.length > 3000
  )
    throw Error("Not a supported Slate project");
  if (
    m.connections !== undefined &&
    (!Array.isArray(m.connections) || m.connections.length > 200)
  )
    throw Error("Invalid park connections");
  const connectionIds = new Set();
  for (const c of m.connections || []) {
    if (
      !c ||
      typeof c.id !== "string" ||
      connectionIds.has(c.id) ||
      m.roads.some((r) => r.id === c.id) ||
      m.nodes.some((n) => n.id === c.id) ||
      !["walkway", "bridge"].includes(c.kind) ||
      !Number.isFinite(c.width) ||
      c.width < (c.kind === "bridge" ? 4 : 1.5) ||
      c.width > 10 ||
      !Array.isArray(c.points) ||
      c.points.length < 2 ||
      c.points.length > 512 ||
      c.points.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some((v) => !Number.isFinite(v) || Math.abs(v) > 10000),
      ) ||
      (c.kind === "bridge" &&
        (!Number.isFinite(c.height) || c.height < 1 || c.height > 12))
    )
      throw Error("Invalid park connection");
    if (
      c.kind === "bridge" &&
      ((c.gradeTarget !== undefined &&
        (!Number.isFinite(c.gradeTarget) ||
          c.gradeTarget < 0.02 ||
          c.gradeTarget > 0.15)) ||
        (c.transition !== undefined &&
          (!Number.isFinite(c.transition) ||
            c.transition < 1 ||
            c.transition > 12)))
    )
      throw Error("Invalid bridge approach settings");
    if (
      c.kind === "bridge" &&
      c.clearanceTarget !== undefined &&
      (!Number.isFinite(c.clearanceTarget) ||
        c.clearanceTarget < 2 ||
        c.clearanceTarget > 10)
    )
      throw Error("Invalid bridge clearance target");
    connectionIds.add(c.id);
  }
  const ids = new Set();
  for (const n of m.nodes) {
    if (n.y !== undefined && (!Number.isFinite(n.y) || n.y < 0 || n.y > 40))
      throw Error("Invalid junction elevation");
    if (
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      ![n.x, n.z].every((v) => Number.isFinite(v) && Math.abs(v) < 10000)
    )
      throw Error("Invalid junction");
    ids.add(n.id);
  }
  for (const r of m.roads) {
    if (r.surface !== undefined && !["asphalt", "concrete"].includes(r.surface))
      throw Error("Invalid road finish");
    if (r.driveway !== undefined && !validDriveway(r.driveway))
      throw Error("Invalid vehicle crossover");
    if (r.speedHump !== undefined && !validHump(r.speedHump))
      throw Error("Invalid speed hump");
    if (
      !ids.has(r.a) ||
      !ids.has(r.b) ||
      !Number.isFinite(r.width) ||
      r.width < 3 ||
      r.width > 30
    )
      throw Error("Invalid road");
    for (const p of [...(r.points || []), ...(r.control ? [r.control] : [])])
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every((v) => Number.isFinite(v) && Math.abs(v) < 10000)
      )
        throw Error("Invalid curve");
  }
  if (
    !Number.isFinite(m.radius) ||
    m.radius < 0 ||
    m.radius > 15 ||
    !Number.isFinite(m.sidewalk) ||
    m.sidewalk < 0 ||
    m.sidewalk > 8
  )
    throw Error("Invalid dimensions");
  if (typeof m.name !== "string" || m.name.length > 100)
    throw Error("Invalid project name");
  if (
    m.materials &&
    (!/^#[0-9a-f]{6}$/i.test(m.materials.asphalt) ||
      !Number.isFinite(m.materials.roughness) ||
      m.materials.roughness < 0.1 ||
      m.materials.roughness > 1 ||
      !PAVING_PATTERNS.includes(m.materials.paving))
  )
    throw Error("Invalid surface material");
  if (m.streets !== undefined && !validateStreetSettings(m.streets))
    throw Error("Invalid streetscape settings");
  const material = m.materials || {};
  if (
    material.pavingScale !== undefined &&
    (!Number.isFinite(material.pavingScale) ||
      material.pavingScale < 0.5 ||
      material.pavingScale > 2)
  )
    throw Error("Invalid paving scale");
  if (
    material.pavingRotation !== undefined &&
    (!Number.isFinite(material.pavingRotation) ||
      material.pavingRotation < 0 ||
      material.pavingRotation > 90)
  )
    throw Error("Invalid paving rotation");
  if (
    material.pavingColor !== undefined &&
    !/^#[0-9a-f]{6}$/i.test(material.pavingColor)
  )
    throw Error("Invalid paving color");
  if (
    m.layers &&
    Object.entries(m.layers).some(
      ([k, v]) => !Object.hasOwn(preset().layers, k) || typeof v !== "boolean",
    )
  )
    throw Error("Invalid layers");
  return {
    ...preset(),
    ...m,
    layers: { ...preset().layers, ...m.layers },
    materials: { ...preset().materials, ...m.materials },
    streets: {
      ...STREET_DEFAULTS,
      ...m.streets,
      rampRun: Math.max(1.8, m.streets?.rampRun ?? 1.8),
    },
    traffic: Math.max(0, Math.min(25, Number(m.traffic) || 0)),
    speed: Math.max(5, Math.min(60, Number(m.speed) || 30)),
  };
}

export function moveJunction(model, id, x, z) {
  const node = model.nodes.find((n) => n.id === id);
  if (!node) return;
  const dx = x - node.x,
    dz = z - node.z;
  for (const road of model.roads) {
    if (road.a !== id && road.b !== id) continue;
    if (road.control) {
      road.control[0] += dx * 0.5;
      road.control[1] += dz * 0.5;
    }
    if (road.points) {
      const count = road.points.length;
      road.points = road.points.map((p, i) => {
        const t = (i + 1) / (count + 1),
          weight = road.a === id ? 1 - t : t;
        return [p[0] + dx * weight, p[1] + dz * weight];
      });
    }
  }
  node.x = x;
  node.z = z;
}
