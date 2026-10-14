//============================================================================================================================================
//                                                             GDFGRID.JS
//============================================================================================================================================
// 📦 Global distance field clipmap management — the CPU half of Lumen's global-distance-field machinery.
//    Three sparse clipmaps (voxel 0.1 / 0.4 / 1.6 m; tile 16³ voxels), toroidally addressed tile tables,
//    pooled tile allocation against the nearest-geometry horizon around the drive focus (the ControlVehicle),
//    per-tile static triangle lists and L0 mesh-card lists for the surface-cache lookups.
//
//    Everything the GPU needs is produced here as flat arrays + dirty write queues; js/gpu.js consumes them.

// clip constants — MUST match shaders/common.wgsl
export const CLIPS = [
  { voxel: 0.1, cell: 1.6, dmax: 1.6, radius: 18, gridDim: 64, poolSize: 2048, cap: 128 },
  { voxel: 0.4, cell: 6.4, dmax: 6.4, radius: 96, gridDim: 48, poolSize: 2048, cap: 192 },
  { voxel: 1.6, cell: 25.6, dmax: 25.6, radius: 400, gridDim: 40, poolSize: 2048, cap: 48 },
];
export const TILE_VOXELS = 16;
const KC = 2048; // cell key center
export const cellKey = (x, y, z) => ((x + KC) * 4096 + (y + KC)) * 4096 + (z + KC);

// pcg3d matching shaders/common.wgsl gdfCellHash (identical integers: the tables are XOR-verified on GPU)
export function gdfCellHash(x, y, z) {
  const mul = (a, b) => (Math.imul(a & 0xffff, b) + ((Math.imul(a >>> 16, b) << 16) >>> 0)) >>> 0;
  let v0 = (mul(mul(x | 0, 1898087), 1664525) + 1013904223) >>> 0;
  let v1 = (mul(mul(y | 0, 852847), 1664525) + 1013904223) >>> 0;
  let v2 = (mul(mul(z | 0, 1632097), 1664525) + 1013904223) >>> 0;
  // two rounds of the mixing ladder identical to pcg3d()
  for (let r = 0; r < 2; r++) {
    v0 = (v0 + mul(v1, v2)) >>> 0; v1 = (v1 + mul(v2, v0)) >>> 0; v2 = (v2 + mul(v0, v1)) >>> 0;
    if (r === 0) { v0 ^= v0 >>> 16; v1 ^= v1 >>> 16; v2 ^= v2 >>> 16; }
  }
  return v0 >>> 0;
}

// ---- soup arrays: entry = 16 floats (a.xyz,_, b.xyz,_, c.xyz,_, n.xyz,_) -----------------------------------
export function meshToSoupEntries(meshes) {
  let tris = 0;
  for (const m of meshes) tris += m.family.length;
  const soup = new Float32Array(tris * 16);
  const triCenter = new Float32Array(tris * 3);
  let o = 0, e = 0;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.family.length; t++) {
      const idx = [m.triangles[t * 3], m.triangles[t * 3 + 1], m.triangles[t * 3 + 2]];
      const a = [p[idx[0] * 3], p[idx[0] * 3 + 1], p[idx[0] * 3 + 2]];
      const b = [p[idx[1] * 3], p[idx[1] * 3 + 1], p[idx[1] * 3 + 2]];
      const c = [p[idx[2] * 3], p[idx[2] * 3 + 1], p[idx[2] * 3 + 2]];
      let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const l = Math.hypot(nx, ny, nz) || 1;
      soup.set([a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, nx / l, ny / l, nz / l, 0], o);
      triCenter.set([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], e * 3);
      o += 16; e++;
    }
  }
  return { soup, triCenter, count: tris };
}

// per-cell entry lists at one clipmap level over a soup
function buildCellLists(soup, triCenter, clip) {
  const lists = new Map();
  const margin = clip.dmax;
  for (let t = 0; t < soup.length / 16; t++) {
    const o = t * 16;
    const minX = Math.min(soup[o], soup[o + 4], soup[o + 8]) - margin;
    const minY = Math.min(soup[o + 1], soup[o + 5], soup[o + 9]) - margin;
    const minZ = Math.min(soup[o + 2], soup[o + 6], soup[o + 10]) - margin;
    const maxX = Math.max(soup[o], soup[o + 4], soup[o + 8]) + margin;
    const maxY = Math.max(soup[o + 1], soup[o + 5], soup[o + 9]) + margin;
    const maxZ = Math.max(soup[o + 2], soup[o + 6], soup[o + 10]) + margin;
    const c0 = [Math.floor(minX / clip.cell), Math.floor(minY / clip.cell), Math.floor(minZ / clip.cell)];
    const c1 = [Math.floor(maxX / clip.cell), Math.floor(maxY / clip.cell), Math.floor(maxZ / clip.cell)];
    for (let x = c0[0]; x <= c1[0]; x++)
      for (let y = c0[1]; y <= c1[1]; y++)
        for (let z = c0[2]; z <= c1[2]; z++) {
          const k = cellKey(x, y, z);
          let l = lists.get(k);
          if (!l) { l = []; lists.set(k, l); }
          l.push(t);
        }
  }
  return lists;
}

export function makeGdfGrid(staticSoupsPerLevel) {
  // staticSoupsPerLevel: [{soup, triCenter, count} x3]
  const levels = CLIPS.map((clip, li) => ({
    clip,
    allocated: new Map(),                // key -> {pool, lastWanted}
    free: Array.from({ length: clip.poolSize }, (_, i) => clip.poolSize - 1 - i),
    table: new Uint32Array(clip.gridDim * clip.gridDim * clip.gridDim * 2),
    cellLists: buildCellLists(staticSoupsPerLevel[li].soup, staticSoupsPerLevel[li].triCenter, clip),
    soup: staticSoupsPerLevel[li],
    cardLists: new Map(),                // L0 only: key -> [cardId,...] (static cards bake once)
  }));
  return { levels, carCells: [new Set(), new Set(), new Set()], epoch: 0, focus: [0, 0, 0] };
}

// ------------------------------- per-frame wants -------------------------------------------------------------
const marker = { static: 1, car: 2 };

function cellsForAABB(min, max, clip, out) {
  const margin = clip.dmax + clip.voxel;
  const c0 = [Math.floor((min[0] - margin) / clip.cell), Math.floor((min[1] - margin) / clip.cell), Math.floor((min[2] - margin) / clip.cell)];
  const c1 = [Math.floor((max[0] + margin) / clip.cell), Math.floor((max[1] + margin) / clip.cell), Math.floor((max[2] + margin) / clip.cell)];
  for (let x = c0[0]; x <= c1[0]; x++)
    for (let y = c0[1]; y <= c1[1]; y++)
      for (let z = c0[2]; z <= c1[2]; z++) out.push([x, y, z]);
  return out;
}

// Focus-based frame planning. dynAABBs = [{min,max}] world boxes of the 5 dynamic Lumen objects.
// Budgets how many tiles get (re)built this frame; car tiles are rebuilt EVERY frame so the field chases the car.
export function planGdfFrame(grid, focus, dynAABBs, budgets) {
  grid.epoch++;
  grid.focus = focus;
  const jobs = [[], [], []];            // per level: {cell, pool, dynMask, entries(Uint32Array), entryCount}
  const tableWrites = [];               // {level, slot, hash, pool1}  (pool1 = pool+1, 0 frees)
  const soupWrites = [];                // {level, pool, data(Float32Array entry-format)}
  const allocsSoFar = [0, 0, 0];

  grid.carCells.forEach(s => s.clear());
  for (let li = 0; li < 3; li++) {
    const clip = CLIPS[li];
    const wantSet = new Map();          // key -> marker bits

    // static-surface cells inside the allocation horizon
    for (const key of grid.levels[li].cellLists.keys()) {
      const z = key % 4096 - KC, y = ((key / 4096) | 0) % 4096 - KC, x = Math.floor(key / 16777216) - KC;
      const cx = (x + 0.5) * clip.cell - focus[0], cy = (y + 0.5) * clip.cell - focus[1], cz = (z + 0.5) * clip.cell - focus[2];
      if (Math.hypot(cx, cy, cz) <= clip.radius + clip.cell) wantSet.set(key, marker.static);
    }

    // dynamic objects: every frame, so the region under the car always chases it
    const carList = [];
    for (const bb of dynAABBs) {
      const cells = cellsForAABB(bb.min, bb.max, clip, []);
      for (const [x, y, z] of cells) {
        const cx = (x + 0.5) * clip.cell - focus[0], cy = (y + 0.5) * clip.cell - focus[1], cz = (z + 0.5) * clip.cell - focus[2];
        if (Math.hypot(cx, cy, cz) > clip.radius + clip.cell) continue;
        const k = cellKey(x, y, z);
        grid.carCells[li].add(k);
        wantSet.set(k, (wantSet.get(k) || 0) | marker.car);
        carList.push(k);
      }
    }

    // evict what's no longer wanted
    const level = grid.levels[li];
    for (const [key, rec] of level.allocated) {
      if (!wantSet.has(key)) {
        level.free.push(rec.pool);
        const z = key % 4096 - KC, y = ((key / 4096) | 0) % 4096 - KC, x = Math.floor(key / 16777216) - KC;
        const sw = slotOf(x, y, z, clip);
        tableWrites.push({ level: li, slot: sw, hash: 0, pool1: 0 });
        level.allocated.delete(key);
      }
    }

    // allocate newly wanted, cheapest first (car cells are wanted most)
    const wanted = [...wantSet.entries()];
    const z0key = (e) => (e[1] & marker.car) ? 0 : 1;
    wanted.sort((a, b) => z0key(a) - z0key(b));
    const dist2Of = (key) => {
      const z = key % 4096 - KC, y = ((key / 4096) | 0) % 4096 - KC, x = Math.floor(key / 16777216) - KC;
      const cx = (x + 0.5) * clip.cell - focus[0], cy = (y + 0.5) * clip.cell - focus[1], cz = (z + 0.5) * clip.cell - focus[2];
      return cx * cx + cy * cy + cz * cz;
    };
    for (const [key, mk] of wanted) {
      if (level.allocated.has(key)) continue;
      if (level.free.length === 0) {
        // pool full: force-evict the farthest allocated non-car tile for car work
        if (!(mk & marker.car)) break;
        let worstKey = -1, worstD = -1;
        for (const [k2] of level.allocated) {
          if (grid.carCells[li].has(k2)) continue;
          const d2 = dist2Of(k2);
          if (d2 > worstD) { worstD = d2; worstKey = k2; }
        }
        if (worstKey === -1) break;
        const rec2 = level.allocated.get(worstKey);
        level.free.push(rec2.pool);
        const z = worstKey % 4096 - KC, y = ((worstKey / 4096) | 0) % 4096 - KC, x = Math.floor(worstKey / 16777216) - KC;
        tableWrites.push({ level: li, slot: slotOf(x, y, z, clip), hash: 0, pool1: 0 });
        level.allocated.delete(worstKey);
      }
      if (allocsSoFar[li] >= budgets.alloc[li] && !(mk & marker.car)) continue;
      const pool = level.free.pop();
      allocsSoFar[li]++;
      const z = key % 4096 - KC, y = ((key / 4096) | 0) % 4096 - KC, x = Math.floor(key / 16777216) - KC;
      level.allocated.set(key, { pool });
      tableWrites.push({ level: li, slot: slotOf(x, y, z, clip), hash: gdfCellHash(x, y, z), pool1: pool + 1 });
      jobs[li].push({ key, cell: [x, y, z], pool, car: !!(mk & marker.car) });
    }

    // rebuild: new allocs + every car-adjacent tile each frame
    for (const [key, rec] of level.allocated) {
      const isCar = grid.carCells[li].has(key);
      const alreadyQueued = jobs[li].some(j => j.key === key);
      if (!isCar || alreadyQueued) continue;
      if (jobs[li].length >= budgets.rebuild[li]) continue;
      const z = key % 4096 - KC, y = ((key / 4096) | 0) % 4096 - KC, x = Math.floor(key / 16777216) - KC;
      jobs[li].push({ key, cell: [x, y, z], pool: rec.pool, car: true });
    }
  }

  // per-job: static soup entries (written into the pool's soup slice) + dyn mask
  for (let li = 0; li < 3; li++) {
    const clip = CLIPS[li];
    const level = grid.levels[li];
    for (const j of jobs[li]) {
      const entries = level.cellLists.get(j.key) || [];
      const capped = entries.slice(0, clip.cap);
      const data = new Float32Array(capped.length * 16);
      for (let e = 0; e < capped.length; e++)
        data.set(level.soup.soup.subarray(capped[e] * 16, capped[e] * 16 + 16), e * 16);
      j.entries = data;
      j.entryCount = capped.length;
      // dynamic mask: which dyn objects touch this tile
      let mask = 0;
      for (let o = 0; o < dynAABBs.length; o++) {
        const bb = dynAABBs[o];
        const mn = [j.cell[0] * clip.cell, j.cell[1] * clip.cell, j.cell[2] * clip.cell];
        const mx = [mn[0] + clip.cell, mn[1] + clip.cell, mn[2] + clip.cell];
        const mm = clip.dmax;
        if (bb.max[0] >= mn[0] - mm && bb.min[0] <= mx[0] + mm &&
            bb.max[1] >= mn[1] - mm && bb.min[1] <= mx[1] + mm &&
            bb.max[2] >= mn[2] - mm && bb.min[2] <= mx[2] + mm) mask |= 1 << o;
      }
      j.dynMask = mask;
      soupWrites.push({ level: li, pool: j.pool, data: j.entries });
    }
  }

  return { jobs, tableWrites, soupWrites, allocs: allocsSoFar };
}

export function slotOf(x, y, z, clip) {
  const d = clip.gridDim;
  const wx = ((x % d) + d) % d, wy = ((y % d) + d) % d, wz = ((z % d) + d) % d;
  return ((wz * d + wy) * d + wx);
}

// apply table writes to the CPU mirror (grid.levels[].table) — the GPU upload uses the same records
export function applyTableWrites(grid, tableWrites) {
  for (const w of tableWrites) {
    const t = grid.levels[w.level].table;
    t[w.slot * 2] = w.hash;
    t[w.slot * 2 + 1] = w.pool1;
  }
}
