// Slate — derived voxelization. The heightmap is primary; voxels are derived
// (columns of cubic cells from a base plane up to the surface + water fill).
import { clamp } from './util.js';

// Column summary at cols×cols for fast instanced rendering.
export function voxelizeColumns(ctx, cols = 64) {
  const n = ctx.n;
  const heights = new Float32Array(cols * cols);
  const water = new Float32Array(cols * cols);
  const tint = new Float32Array(cols * cols * 3);
  for (let y = 0; y < cols; y++) for (let x = 0; x < cols; x++) {
    const sx = Math.min(n - 1, Math.round((x / (cols - 1)) * (n - 1)));
    const sy = Math.min(n - 1, Math.round((y / (cols - 1)) * (n - 1)));
    const i = sy * n + sx, o = y * cols + x;
    heights[o] = ctx.h[i];
    water[o] = Math.max(0, ctx.waterLevel - ctx.h[i]);
    tint[o * 3] = ctx.alb[i * 3]; tint[o * 3 + 1] = ctx.alb[i * 3 + 1]; tint[o * 3 + 2] = ctx.alb[i * 3 + 2];
  }
  return { cols, heights, water, tint };
}

// Full occupancy grid for stats / export. occ=1 solid, water=1 water cell.
export function voxelizeFull(ctx, xy = 96, hgt = 48) {
  const n = ctx.n;
  const occ = new Uint8Array(xy * xy * hgt);
  const water = new Uint8Array(xy * xy * hgt);
  let solid = 0, wet = 0;
  for (let y = 0; y < xy; y++) for (let x = 0; x < xy; x++) {
    const sx = Math.min(n - 1, Math.round((x / (xy - 1)) * (n - 1)));
    const sy = Math.min(n - 1, Math.round((y / (xy - 1)) * (n - 1)));
    const h = clamp(ctx.h[sy * n + sx]);
    const w = clamp(ctx.waterLevel);
    const topSolid = Math.round(h * (hgt - 1));
    const topWater = Math.round(Math.max(h, w) * (hgt - 1));
    for (let z = 0; z <= topSolid && z < hgt; z++) { occ[(z * xy + y) * xy + x] = 1; solid++; }
    for (let z = topSolid + 1; z <= topWater && z < hgt; z++) { water[(z * xy + y) * xy + x] = 1; wet++; }
  }
  return { xy, h: hgt, occ, water, solid, wet, total: xy * xy * hgt };
}

export function voxelStats(v) {
  return {
    dims: `${v.xy}×${v.xy}×${v.h}`,
    solid: v.solid,
    water: v.wet,
    fillPct: +(((v.solid + v.wet) / v.total) * 100).toFixed(2),
  };
}
