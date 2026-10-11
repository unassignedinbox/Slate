import ClipperLib from "clipper-lib";
import { triangulate } from "./network.js";
// Cut before triangulating: no triangle can span an entire city block or bridge
// distant hole boundaries. Shared cuts use the same integer millimetre grid.
function clip(paths, x0, z0, x1, z1) {
  const c = new ClipperLib.Clipper(),
    out = [];
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  c.AddPath(
    [
      { X: x0, Y: z0 },
      { X: x1, Y: z0 },
      { X: x1, Y: z1 },
      { X: x0, Y: z1 },
    ],
    ClipperLib.PolyType.ptClip,
    true,
  );
  c.Execute(
    ClipperLib.ClipType.ctIntersection,
    out,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return out;
}
export function localMesh(paths, y, cell = 6) {
  const out = { positions: [], indices: [], uvs: [] };
  if (!paths.some((p) => p.length)) return out;
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const path of paths)
    for (const p of path) {
      x0 = Math.min(x0, p.X);
      x1 = Math.max(x1, p.X);
      z0 = Math.min(z0, p.Y);
      z1 = Math.max(z1, p.Y);
    }
  const step = cell * 1000;
  for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
    const strip = clip(paths, x, z0 - 1, x + step, z1 + 1);
    if (!strip.length) continue;
    let stripMin = Infinity,
      stripMax = -Infinity;
    for (const path of strip)
      for (const p of path) {
        stripMin = Math.min(stripMin, p.Y);
        stripMax = Math.max(stripMax, p.Y);
      }
    for (let z = Math.floor(stripMin / step) * step; z < stripMax; z += step) {
      const tile = clip(strip, x, z, x + step, z + step);
      if (!tile.length) continue;
      const d = triangulate(tile, y),
        base = out.positions.length / 3;
      for (const v of d.positions) out.positions.push(v);
      for (const v of d.uvs) out.uvs.push(v);
      for (const i of d.indices) out.indices.push(base + i);
    }
  }
  return out;
}
