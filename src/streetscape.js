import ClipperLib from "clipper-lib";
import { union, triangulate, nearestOnSegment } from "./network.js";
import { atStation, distance } from "./alignment.js";
import { humpSpec } from "./traffic-calming.js";
import { streetSettings } from "./street-settings.js";
const S = 1000,
  clamp = (v) => Math.max(0, Math.min(1, v));
export function pathOf(points) {
  const p = points.map((v) => ({
    X: Math.round(v[0] * S),
    Y: Math.round(v[1] * S),
  }));
  if (!ClipperLib.Clipper.Orientation(p)) p.reverse();
  return p;
}
// Utility openings retain every millimeter-grid boundary vertex. Cleaning an
// already cut circular hole can move its edge back under the cast-iron cover.
function difference(a, b) {
  if (!b.length) return a;
  const c = new ClipperLib.Clipper(),
    out = [];
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  c.Execute(
    ClipperLib.ClipType.ctDifference,
    out,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return out;
}
export function intersection(a, b) {
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
export const area = (paths) =>
  Math.abs(
    paths.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p) / S ** 2, 0),
  );
export function frameAt(r, s) {
  const p = atStation(r.samples, s);
  const widths = r.samples.widths;
  return {
    ...p,
    width: widths
      ? widths[p.index] * (1 - p.t) +
        widths[Math.min(p.index + 1, widths.length - 1)] * p.t
      : r.width,
  };
}
export function localPoint(p, u, v) {
  return [p.x + p.dx * u - p.dz * v, p.z + p.dz * u + p.dx * v];
}
function rectangle(p, u0, u1, v0, v1) {
  return pathOf(
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ].map(([u, v]) => localPoint(p, u, v)),
  );
}
export function crossingLayout(model, data) {
  const result = [],
    settings = streetSettings(model);
  if (model.layers.crossings === false) return result;
  for (const road of data.sampled) {
    if (road.surface === "concrete") continue;
    const len = road.samples.lengthMeters;
    for (const [nodeId, reverse] of [
      [road.a, false],
      [road.b, true],
    ]) {
      const incident = model.roads.filter(
        (r) => r.a === nodeId || r.b === nodeId,
      );
      if (incident.length < 3) continue;
      const setback =
        Math.max(...incident.map((r) => r.width)) / 2 + model.radius + 2;
      if (len < setback * 2 + settings.crossingWidth + 2) continue;
      const s = reverse ? len - setback : setback;
      result.push({
        id: road.id + ":" + nodeId,
        road: road.id,
        nodeId,
        reverse,
        s,
        p: frameAt(road, s),
        length: settings.crossingWidth,
      });
    }
  }
  return result;
}
export function rampPoint(r, u, v) {
  const p = r.source ? frameAt(r.source, r.s + u) : r.p;
  return localPoint(p, r.source ? 0 : u, r.side * (p.width / 2 + v));
}
function rampLocal(r, x, z) {
  const dx = x - r.p.x,
    dz = z - r.p.z,
    rough = {
      u: dx * r.p.dx + dz * r.p.dz,
      v: (-dx * r.p.dz + dz * r.p.dx) * r.side - r.p.width / 2,
    };
  if (
    !r.source ||
    Math.abs(rough.u) > r.half + Math.max(r.run, r.flare) + 3 ||
    rough.v < -2 ||
    rough.v > r.depth + 3
  )
    return rough;
  const samples = r.source.samples;
  let best = null;
  for (let i = r.first; i < r.last; i++) {
    const hit = nearestOnSegment([x, z], samples[i], samples[i + 1]);
    if (!best || hit.distance < best.distance) best = { ...hit, index: i };
  }
  if (!best) return rough;
  const s =
      samples.stations[best.index] +
      best.t *
        (samples.stations[best.index + 1] - samples.stations[best.index]),
    p = frameAt(r.source, s);
  return {
    u: s - r.s,
    v: ((x - p.x) * -p.dz + (z - p.z) * p.dx) * r.side - p.width / 2,
  };
}
export function rampHeight(r, x, z) {
  const { u, v } = rampLocal(r, x, z);
  return (
    0.12 +
    0.15 *
      clamp(
        r.kind === "parallel"
          ? (Math.abs(u) - r.half) / r.run
          : Math.max(v / r.run, (Math.abs(u) - r.half) / r.flare),
      )
  );
}
export function pavementHeight(street, x, z) {
  let y = 0.27;
  for (const r of [...street.ramps, ...(street.driveways || [])]) {
    const { u, v } = rampLocal(r, x, z);
    const reach = r.kind === "parallel" ? r.run : r.flare;
    if (
      Math.abs(u) <= r.half + reach + 0.002 &&
      v >= -0.252 &&
      v <= r.depth + 0.002
    )
      y = Math.min(y, rampHeight(r, x, z));
  }
  return y;
}
function rampPath(r, coords) {
  const points = [];
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i],
      b = coords[(i + 1) % coords.length],
      count = Math.max(1, Math.ceil(Math.abs(b[0] - a[0]) / 0.35));
    for (let j = 0; j < count; j++)
      points.push(
        rampPoint(
          r,
          a[0] + ((b[0] - a[0]) * j) / count,
          a[1] + ((b[1] - a[1]) * j) / count,
        ),
      );
  }
  return pathOf(points);
}
function prepareRamp(r) {
  const reach = r.kind === "parallel" ? r.run : r.flare;
  r.first = Math.max(
    0,
    atStation(r.source.samples, r.s - r.half - reach - 3).index,
  );
  r.last = Math.min(
    r.source.samples.length - 1,
    atStation(r.source.samples, r.s + r.half + reach + 3).index + 1,
  );
  r.footprint = rampPath(r, [
    [-r.half - reach, -0.25],
    [r.half + reach, -0.25],
    [r.half + reach, r.depth],
    [-r.half - reach, r.depth],
  ]);
  return r;
}
const emptyMesh = () => ({ positions: [], indices: [], uvs: [] });
function appendMesh(out, d, height) {
  const base = out.positions.length / 3;
  for (let i = 0; i < d.positions.length; i += 3) {
    const x = d.positions[i],
      z = d.positions[i + 2];
    out.positions.push(x, height ? height(x, z) : d.positions[i + 1], z);
  }
  out.uvs.push(...d.uvs);
  out.indices.push(...d.indices.map((i) => i + base));
}
function rampPatches(r, source) {
  const { half: a, flare: f, run: h } = r,
    b = a + f;
  // Each polygon is a planar part of the ramp. Diagonal flares meet the central
  // slope exactly; no overlay under the patches and no raised curb across toe.
  let pieces;
  if (r.kind === "parallel")
    pieces = [
      [-a - h, -a],
      [-a, a],
      [a, a + h],
    ].map(([u0, u1]) => [
      [u0, -0.25],
      [u1, -0.25],
      [u1, r.depth],
      [u0, r.depth],
    ]);
  else {
    pieces = [
      [-a, a, -0.25, 0],
      [-a, a, 0, h],
    ].map(([u0, u1, v0, v1]) => [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]);
    for (const side of [-1, 1]) {
      pieces.push([
        [side * a, -0.25],
        [side * b, -0.25],
        [side * b, 0],
        [side * a, 0],
      ]);
      pieces.push([
        [side * a, 0],
        [side * b, 0],
        [side * b, h],
      ]);
      pieces.push([
        [side * a, 0],
        [side * b, h],
        [side * a, h],
      ]);
    }
  }
  const out = emptyMesh();
  for (const piece of pieces) {
    const path = rampPath(r, piece);
    appendMesh(out, triangulate(intersection([path], source), 0.27), (x, z) =>
      rampHeight(r, x, z),
    );
  }
  return out;
}
function circle(x, z, r) {
  return pathOf(
    Array.from({ length: 64 }, (_, i) => [
      x + Math.cos((i * Math.PI) / 32) * r,
      z + Math.sin((i * Math.PI) / 32) * r,
    ]),
  );
}
function band(road, start, end, side, inner = 0.38, outer = 0) {
  const a = [],
    b = [];
  const count = Math.ceil((end - start) / 0.5);
  for (let i = 0; i <= count; i++) {
    const p = frameAt(road, start + ((end - start) * i) / count);
    a.push(localPoint(p, 0, side * (p.width / 2 - inner)));
    b.push(localPoint(p, 0, side * (p.width / 2 - outer)));
  }
  return pathOf([...a, ...b.reverse()]);
}
export function buildStreetscape(model, data) {
  const settings = streetSettings(model),
    crossings = crossingLayout(model, data),
    ramps = [],
    driveways = [],
    rampCuts = [],
    warnings = [];
  const vehicleRamp = emptyMesh();
  const walkRamp = emptyMesh(),
    curbRamp = emptyMesh(),
    tactileMesh = emptyMesh(),
    tactiles = [];
  if (model.layers.ramps !== false) {
    for (const crossing of crossings) {
      if (model.sidewalk < 1.5) {
        warnings.push("Sidewalk too narrow for curb ramps");
        continue;
      }
      for (const side of [-1, 1]) {
        const source = data.sampled.find((r) => r.id === crossing.road),
          run = Math.max(1.8, settings.rampRun),
          total = model.sidewalk + 0.22;
        const kind =
          settings.pedestrianMode === "auto"
            ? total - run >= 1.22
              ? "perpendicular"
              : "parallel"
            : settings.pedestrianMode;
        if (kind === "perpendicular" && total - run < 1.22) {
          warnings.push(
            "Pedestrian ramp needs a 1.22 m top landing; use Auto/parallel or widen pavement",
          );
          continue;
        }
        const reach = kind === "parallel" ? run : 1.5;
        if (
          crossing.s - crossing.length / 2 - reach < 0 ||
          crossing.s + crossing.length / 2 + reach > source.samples.lengthMeters
        ) {
          warnings.push("Pedestrian ramp cannot fit the approach");
          continue;
        }
        const r = prepareRamp({
          id: crossing.id + ":" + side,
          crossing: crossing.id,
          roadId: source.id,
          source,
          s: crossing.s,
          p: crossing.p,
          side,
          run,
          half: crossing.length / 2,
          flare: 1.5,
          kind,
          depth: kind === "parallel" ? total + 0.002 : run,
        });
        if (
          rampCuts.length &&
          area(intersection([r.footprint], rampCuts)) > 0.001
        ) {
          warnings.push("Overlapping ramp suppressed");
          continue;
        }
        const patches = intersection([r.footprint], data.walk);
        if (area(patches) < 1) {
          warnings.push("Ramp without sufficient pavement suppressed");
          continue;
        }
        ramps.push(r);
        rampCuts.push(r.footprint);
        let rampWalk = patches;
        if (settings.tactile) {
          const footprint = rampPath(r, [
            [-r.half + 0.2, 0.35],
            [r.half - 0.2, 0.35],
            [r.half - 0.2, 0.95],
            [-r.half + 0.2, 0.95],
          ]);
          const paths = intersection([footprint], patches);
          if (area(paths) > 0.5) {
            tactiles.push({ ramp: r, paths });
            rampWalk = difference(patches, [footprint]);
            appendMesh(tactileMesh, triangulate(paths, 0.27), (x, z) =>
              rampHeight(r, x, z),
            );
          }
        }
        appendMesh(walkRamp, rampPatches(r, rampWalk));
        appendMesh(
          curbRamp,
          rampPatches(r, intersection([r.footprint], data.curb)),
        );
        if (0.15 / run > 1 / 12 + 0.0001)
          warnings.push("Ramp running slope exceeds 1:12");
        if (kind !== "parallel" && model.sidewalk + 0.22 - run < 1.22)
          warnings.push("Back landing is less than 1.2 m");
      }
    }
  }
  if (model.layers.driveways !== false) {
    for (const source of data.sampled) {
      const config = source.driveway;
      if (!config) continue;
      const s = source.samples.lengthMeters * config.position,
        clear = source.width / 2 + model.radius + config.width / 2 + 1.5 + 2;
      if (model.sidewalk + 0.22 - config.run < 1.22) {
        warnings.push(
          "Vehicle crossover needs a 1.22 m level footway behind its apron; widen pavement",
        );
        continue;
      }
      if (s < clear || source.samples.lengthMeters - s < clear) {
        warnings.push(
          "Vehicle crossover is too close to a road end or junction",
        );
        continue;
      }
      if (
        crossings.some(
          (c) =>
            c.road === source.id &&
            Math.abs(c.s - s) < c.length / 2 + config.width / 2 + 4,
        )
      ) {
        warnings.push("Vehicle crossover overlaps a pedestrian crossing");
        continue;
      }
      const hump = humpSpec(source, model);
      if (
        hump &&
        Math.abs(hump.center - s) < hump.length / 2 + config.width / 2 + 2
      ) {
        warnings.push("Vehicle crossover overlaps a speed hump");
        continue;
      }
      const r = prepareRamp({
        id: source.id + ":driveway",
        roadId: source.id,
        source,
        s,
        p: frameAt(source, s),
        side: config.side,
        run: config.run,
        half: config.width / 2,
        flare: 1.5,
        depth: config.run,
        kind: "vehicle",
      });
      if (
        rampCuts.length &&
        area(intersection([r.footprint], rampCuts)) > 0.001
      ) {
        warnings.push("Vehicle crossover overlaps a ramp");
        continue;
      }
      const patches = intersection([r.footprint], data.walk);
      if (
        area(patches) <
        config.width * Math.max(0.1, config.run - 0.22) * 0.9
      ) {
        warnings.push("Vehicle crossover does not fit the pavement");
        continue;
      }
      driveways.push(r);
      rampCuts.push(r.footprint);
      appendMesh(vehicleRamp, rampPatches(r, patches));
      appendMesh(
        curbRamp,
        rampPatches(r, intersection([r.footprint], data.curb)),
      );
    }
  }
  const cuts = rampCuts.length ? union(rampCuts) : [],
    walk = cuts.length ? difference(data.walk, cuts) : data.walk,
    curb = cuts.length ? difference(data.curb, cuts) : data.curb;
  const channels = [],
    grates = [],
    manholes = [],
    asphaltCuts = [];
  function clearStation(road, s, margin = 3, side = 0) {
    if (
      driveways.some(
        (d) =>
          d.roadId === road.id &&
          (!side || d.side === side) &&
          Math.abs(d.s - s) < d.half + d.flare + margin,
      )
    )
      return false;
    const len = road.samples.lengthMeters;
    const end = (id, d) => {
      const degree = model.roads.filter((r) => r.a === id || r.b === id).length;
      return (
        d >
        (degree > 2
          ? Math.max(
              ...model.roads
                .filter((r) => r.a === id || r.b === id)
                .map((r) => r.width),
            ) /
              2 +
            model.radius +
            1
          : 3)
      );
    };
    if (!end(road.a, s) || !end(road.b, len - s)) return false;
    if (
      crossings.some(
        (c) => c.road === road.id && Math.abs(c.s - s) < c.length / 2 + margin,
      )
    )
      return false;
    const h = humpSpec(road, model);
    return !h || Math.abs(s - h.center) > h.length / 2 + margin;
  }
  for (const road of data.sampled) {
    if (road.surface === "concrete") continue;
    const len = road.samples.lengthMeters;
    if (model.layers.drainage !== false) {
      for (const side of [-1, 1]) {
        let start = null;
        for (let s = 0; s <= len + 0.5; s += 0.5) {
          const ok = s < len && clearStation(road, s, 2, side);
          if (ok && start === null) start = s;
          if (!ok && start !== null) {
            const end = Math.min(s - 0.5, len);
            if (end - start > 1.5) {
              const paths = intersection(
                [band(road, start, end, side)],
                data.surface,
              );
              channels.push({ road: road.id, side, start, end, paths });
              asphaltCuts.push(...paths);
            }
            start = null;
          }
        }
        for (let s = 18; s < len - 8; s += settings.drainSpacing) {
          if (!clearStation(road, s, 4, side)) continue;
          const p = frameAt(road, s),
            lateral = side * (p.width / 2 - 0.19),
            position = localPoint(p, 0, lateral),
            g = {
              road: road.id,
              s,
              side,
              p: { ...p, x: position[0], z: position[1] },
              width: 0.32,
              length: 0.9,
            };
          g.footprint = rectangle(g.p, -0.45, 0.45, -0.16, 0.16);
          if (area(difference([g.footprint], data.surface)) > 0.00001) continue;
          if (
            !channels.some(
              (ch) =>
                ch.road === road.id &&
                ch.side === side &&
                s > ch.start + 0.5 &&
                s < ch.end - 0.5,
            )
          )
            continue;
          grates.push(g);
        }
      }
    }
    if (model.layers.manholes !== false) {
      const stations = [];
      for (
        let s =
          len < settings.manholeSpacing ? len / 2 : settings.manholeSpacing / 2;
        s < len - 8;
        s += settings.manholeSpacing
      )
        stations.push(s);
      for (const s of stations) {
        if (!clearStation(road, s, 5)) continue;
        const p = frameAt(road, s),
          position = localPoint(p, 0, p.width * 0.2),
          m = {
            road: road.id,
            s,
            x: position[0],
            z: position[1],
            radius: settings.manholeDiameter / 2,
          };
        m.footprint = circle(m.x, m.z, m.radius);
        if (area(difference([m.footprint], data.surface)) > 0.00001) continue;
        if (
          manholes.some(
            (other) =>
              distance([other.x, other.z], position) <
              m.radius + other.radius + 1,
          )
        )
          continue;
        manholes.push(m);
        asphaltCuts.push(m.footprint);
      }
    }
  }
  const channelPaths = channels.length
      ? union(channels.flatMap((c) => c.paths))
      : [],
    grateCuts = grates.map((g) => g.footprint),
    gutters = grateCuts.length
      ? difference(channelPaths, grateCuts)
      : channelPaths;
  const gutterMesh = emptyMesh();
  for (const channel of channels) {
    const localGrates = grates
      .filter(
        (g) =>
          g.road === channel.road &&
          g.side === channel.side &&
          g.s >= channel.start &&
          g.s <= channel.end,
      )
      .map((g) => g.footprint);
    const localGutters = localGrates.length
      ? difference(channel.paths, localGrates)
      : channel.paths;
    const road = data.sampled.find((r) => r.id === channel.road);
    const height = (x, z) => {
      let best = null;
      for (let i = 1; i < road.samples.length; i++) {
        const hit = nearestOnSegment(
          [x, z],
          road.samples[i - 1],
          road.samples[i],
        );
        if (!best || hit.distance < best.distance)
          best = { ...hit, index: i - 1 };
      }
      const width =
        road.samples.widths[best.index] * (1 - best.t) +
        road.samples.widths[best.index + 1] * best.t;
      return (
        0.12 -
        0.025 * (1 - clamp(Math.abs(best.distance - (width / 2 - 0.19)) / 0.19))
      );
    };
    for (const [inner, outer] of [
      [0.38, 0.19],
      [0.19, 0],
    ]) {
      const paths = intersection(
        [band(road, channel.start, channel.end, channel.side, inner, outer)],
        localGutters,
      );
      appendMesh(gutterMesh, triangulate(paths, 0.12), height);
    }
  }
  // Clip the road deck itself: wells and cover frames are seated in these holes.
  const asphalt = asphaltCuts.length
    ? difference(data.surface, union(asphaltCuts))
    : data.surface;
  return {
    settings,
    crossings,
    ramps,
    driveways,
    vehicleRamp,
    walkRamp,
    curbRamp,
    tactileMesh,
    tactiles,
    walk,
    curb,
    channels,
    gutters,
    gutterMesh,
    grates,
    manholes,
    asphalt,
    warnings: [...new Set(warnings)],
  };
}
export function containsPoint(paths, x, z) {
  const point = { X: Math.round(x * S), Y: Math.round(z * S) };
  let winding = 0;
  for (const path of paths) {
    const hit = ClipperLib.Clipper.PointInPolygon(point, path);
    if (hit === -1) return true;
    if (hit) winding += ClipperLib.Clipper.Orientation(path) ? 1 : -1;
  }
  return winding !== 0;
}
