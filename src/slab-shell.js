import { triangulate, fromPath } from "./network.js";
// Contours represent MATERIAL, not the road hole. Clipper outer contours and
// hole contours have opposite orientation, so their right-hand normal always
// points out of the slab. No DoubleSide workaround is needed.
export function slabShell(
  paths,
  heightAt,
  bottom = -0.2,
  step = 0.15,
  creaseVertices = [],
  bottomMesh = null,
) {
  // Include top-patch crease vertices so sampled walls cannot bridge a ramp
  // kink and leave a triangular slit. A spatial index keeps large networks cheap.
  const buckets = new Map();
  for (let i = 0; i < creaseVertices.length; i += 3) {
    const x = creaseVertices[i],
      z = creaseVertices[i + 2],
      key = `${Math.floor(x / 5)},${Math.floor(z / 5)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push([x, z]);
  }
  const positions = [],
    indices = [],
    uvs = [];
  for (const path of paths) {
    const points = fromPath(path);
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        count = Math.max(1, Math.ceil(length / step));
      if (length < 1e-8) continue;
      const splits = Array.from({ length: count + 1 }, (_, i) => i / count),
        dx = b[0] - a[0],
        dz = b[1] - a[1];
      for (
        let x = Math.floor((Math.min(a[0], b[0]) - 0.002) / 5);
        x <= Math.floor((Math.max(a[0], b[0]) + 0.002) / 5);
        x++
      )
        for (
          let z = Math.floor((Math.min(a[1], b[1]) - 0.002) / 5);
          z <= Math.floor((Math.max(a[1], b[1]) + 0.002) / 5);
          z++
        )
          for (const v of buckets.get(`${x},${z}`) || []) {
            const t =
              ((v[0] - a[0]) * dx + (v[1] - a[1]) * dz) / (length * length);
            if (
              t > 0 &&
              t < 1 &&
              Math.abs((v[0] - a[0]) * dz - (v[1] - a[1]) * dx) / length <=
                0.0015
            )
              splits.push(t);
          }
      splits.sort((a, b) => a - b);
      const cuts = splits.filter((t, i) => !i || t - splits[i - 1] > 1e-8);
      for (let j = 0; j < cuts.length - 1; j++) {
        const p = [a[0] + dx * cuts[j], a[1] + dz * cuts[j]],
          q = [a[0] + dx * cuts[j + 1], a[1] + dz * cuts[j + 1]];
        const yp = heightAt(...p),
          yq = heightAt(...q),
          k = positions.length / 3;
        positions.push(
          p[0],
          typeof bottom === "function" ? bottom(...p) : bottom,
          p[1],
          q[0],
          typeof bottom === "function" ? bottom(...q) : bottom,
          q[1],
          q[0],
          yq,
          q[1],
          p[0],
          yp,
          p[1],
        );
        const segment = length * (cuts[j + 1] - cuts[j]);
        uvs.push(0, 0, segment, 0, segment, yq, 0, yp);
        indices.push(k, k + 2, k + 1, k, k + 3, k + 2);
      }
    }
  }
  const cap =
      bottomMesh ||
      triangulate(paths, typeof bottom === "function" ? 0 : bottom),
    base = positions.length / 3;
  if (!bottomMesh && typeof bottom === "function")
    for (let i = 0; i < cap.positions.length; i += 3)
      cap.positions[i + 1] = bottom(cap.positions[i], cap.positions[i + 2]);
  for (const v of cap.positions) positions.push(v);
  for (const v of cap.uvs) uvs.push(v);
  for (let i = 0; i < cap.indices.length; i += 3)
    indices.push(
      base + cap.indices[i],
      base + cap.indices[i + 2],
      base + cap.indices[i + 1],
    );
  return { positions, indices, uvs };
}
