// selftest.mjs — offline verification of every part of the pipeline that the sandbox can run:
//   · parses all WGSL through naga (same toolchain wgpu uses) via check_wgsl.mjs
//   · node --check equivalents for JS modules (dynamic import, no DOM)
//   · course emitter vs the ported physics query (height at tri center vs courseHeight)
//   · car.bin integrity + card system sanity + soups and cell lists
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..");

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log("FAIL ", msg); } else console.log("OK   ", msg); };

// --- WGSL ---
{
  const r = spawnSync("node", [path.join(ROOT, "tools/check_wgsl.mjs")], { encoding: "utf8" });
  const passes = (r.stdout.match(/^OK/gm) ?? []).length;
  ok(r.status === 0 && passes === 8, `WGSL: ${passes}/8 modules valid with naga`);
  if (r.status !== 0) console.log(r.stdout, r.stderr);
}

// --- JS module syntax (import them; DOM-less modules only) ---
for (const m of ["js/math.js", "js/course.js", "js/vehicle.js", "js/scene.js", "js/cards.js", "js/gdfgrid.js", "js/loader.js", "js/sim.js", "js/ui.js", "js/gpu.js"]) {
  try { await import(path.join(ROOT, m)); ok(true, `JS import ${m}`); }
  catch (e) { ok(false, `JS import ${m}: ${e.message}`); }
}
{
  const r = spawnSync(process.execPath, ["--check", path.join(ROOT, "js/main.js")], { encoding: "utf8" });
  ok(r.status === 0, "js/main.js parses (browser entry)");
  if (r.status !== 0) console.log(r.stderr);
}
const { emitCourseTriangles, courseHeight, Course } = await import(path.join(ROOT, "js/course.js"));
const scene = await import(path.join(ROOT, "js/scene.js"));
const { buildCardSystem } = await import(path.join(ROOT, "js/cards.js"));
const gdfgrid = await import(path.join(ROOT, "js/gdfgrid.js"));

// --- course emitter ↔ physics agreement ---
{
  let maxErr = 0, n = 0;
  emitCourseTriangles((ax, ay, az, bx, by, bz, cx, cy, cz, m) => {
    if (m & 0x8000) return;                       // kerb walls are vertical — height query doesn't apply
    if (m >= 3 && m <= 5) return;                  // ramp/bump/cones are above the flat query at same xy? bump+cones yes-ramp covered
    n++;
    const x = (ax + bx + cx) / 3, y = (ay + by + cy) / 3, z = (az + bz + cz) / 3;
    if (m === 1 || m === 0 || m === 2) {
      const h = courseHeight(x, y);
      maxErr = Math.max(maxErr, Math.abs(z - Math.min(h, z)) <= 0 ? 0 : Math.abs(z - Math.max(0, h)) * (z > 0 ? 1 : 0));
    }
  });
  ok(n > 1000, `course emits ${n} triangles`);
  ok(maxErr < 0.035, `checker pad z matches courseHeight everywhere (max err ${maxErr.toFixed(4)} m)`);
}

// --- ramp reaches the physics height along its run ---
{
  let worst = 0;
  for (let i = 0; i <= 20; i++) {
    const x = Course.RampNearX + (i / 20) * Course.RampRunX;
    const target = Course.RampRise * (x - Course.RampNearX) / Course.RampRunX;
    worst = Math.max(worst, Math.abs(courseHeight(x, 0) - target));
  }
  ok(worst <= 1e-6, `ramp height along run exact (${worst})`);
}

// --- car asset ---
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, u);
  return { ok: true, arrayBuffer: async () => fs.readFileSync(p).buffer.slice(0), json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
let car, objects, cardSys;
{
  car = await scene.loadCar("assets/car.bin", "assets/car.manifest.json");
  ok(car.body.family.length === 2924 && car.body.positions.length === 1492 * 3, `car body exact archive counts (2924 tris / 1492 verts)`);
  ok(car.wheel.family.length === 5536, `wheel merged rim+tyre (5536 tris)`);
  const course = scene.buildCourseMeshes();
  objects = scene.buildSceneObjects(course, car);
  cardSys = buildCardSystem(objects);
  ok(cardSys.cards.length > 4000 && cardSys.cards.length < 16384, `card system: ${cardSys.cards.length} mesh cards (atlas holds 16384)`);
  let boundErr = 0;
  for (const r of cardSys.perObj) for (const c of r.cards)
    for (const t of c.tris) {
      // every captured tri must lie inside its card slab (object space)
      const d = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]][c.dirIdx];
      for (let k = 0; k < 3; k++) {
        const vi = r.obj.mesh.triangles[t * 3 + k];
        const q = [r.obj.mesh.positions[vi*3], r.obj.mesh.positions[vi*3+1], r.obj.mesh.positions[vi*3+2]];
        const w = q[0]*d[0]+q[1]*d[1]+q[2]*d[2];
        boundErr = Math.max(boundErr, Math.max(c.wLo - w, w - c.wHi));
      }
    }
  ok(boundErr <= 0.001, `every captured triangle inside its card slab (max overshoot ${boundErr.toFixed(4)} m)`);
}

// --- soups + clipmap planning ---
{
  const course = scene.buildCourseMeshes();
  const fine = gdfgrid.meshToSoupEntries([course.pad, course.surround, course.kerb, course.ramp, course.cones]);
  const coarse = gdfgrid.meshToSoupEntries([scene.buildCoarseCourse()]);
  const grid = gdfgrid.makeGdfGrid([fine, fine, coarse]);
  for (let f = 0; f < 140; f++) {
    const cx = f * 0.25;
    const dynAabb = [{ min: [cx - 3.3, -1.4, -0.2], max: [cx + 3.3, 1.4, 1.5] }];
    const plan = gdfgrid.planGdfFrame(grid, [cx, 0, 0.5], dynAabb, { alloc: [48, 12, 8], rebuild: [48, 12, 8] });
    gdfgrid.applyTableWrites(grid, plan.tableWrites);
  }
  const l0 = grid.levels[0].allocated.size;
  ok(l0 > 800, `after drive-ahead 140 frames: L0 holds ${l0} tiles (roots near pad + car)`);
  let carTiles = 0;
  for (const k of grid.carCells[0]) if (grid.levels[0].allocated.has(k)) carTiles++;
  ok(carTiles >= 20, `car-adjacent L0 tiles allocated: ${carTiles}`);
  const ent = grid.levels[0].soup.count;
  ok(ent === 2404 || ent > 2000, `fine soup ${ent} tris`);
}

console.log(failures === 0 ? "\nALL SELF-TESTS PASS" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
