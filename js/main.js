//============================================================================================================================================
//                                                               MAIN.JS
//============================================================================================================================================
// 📦 Boot + frame orchestration for the WebGPU SDF GI demo.
//    Pipeline (Lumen stage-for-stage):
//      MeshSDF bake → mesh-card capture → surface-cache relight (amortized) → GlobalDF clipmap tiles
//      → voxel lighting (amortized) → final gather cone tracing → composite.
//    CPU here only plans transforms/jobs; every field and lighting evaluation runs on the GPU.

import { loadCar, buildCourseMeshes, buildCoarseCourse, buildSceneObjects, bakeRenderStream, MATERIALS } from "./scene.js";
import { buildCardSystem, packCardsWorld, cardWorldAABB } from "./cards.js";
import { makeGdfGrid, planGdfFrame, applyTableWrites, meshToSoupEntries, CLIPS, cellKey } from "./gdfgrid.js";
import { requestGpu, SdfGiGpu } from "./gpu.js";
import { makeSim, stepSim, viewSim } from "./sim.js";
import { VehicleSpec, bodyOrigin } from "./vehicle.js";
import { mat4Identity, mat4Invert, mat4Multiply, mat4Translate, mat4RotY, mat4RotZ, mat4FromYawPitchRoll, mat4TransformPoint } from "./math.js";
import { makeUi, frameStats } from "./ui.js";
import { Course, courseHeight } from "./course.js";

const $ = (q) => document.querySelector(q);

async function boot() {
  // ------------------------------------------------ scene ------------------------------------------------
  const manifest = await (await fetch("assets/car.manifest.json")).json();
  const car = await loadCar();
  const course = buildCourseMeshes();
  const coarse = buildCoarseCourse();
  const objects = buildSceneObjects(course, car);
  const t0 = performance.now();
  const cardSystem = buildCardSystem(objects);
  const renderStream = bakeRenderStream(objects);
  let cardIdx = 0;
  for (const r of cardSystem.perObj) { r.firstCard = cardIdx; cardIdx += r.cards.length; }
  const staticObjs = objects.filter(o => !o.dynamic);
  const dynObjs = objects.filter(o => o.dynamic);          // [body, wheelFL, wheelFR, wheelRL, wheelRR]
  const firstDynCard = cardSystem.perObj.find(r => r.obj.dynamic).firstCard;
  const dynCardCount = cardSystem.cards.length - firstDynCard;

  // static soups per clip level (fine / fine / coarse)
  const soupFine = meshToSoupEntries([course.pad, course.surround, course.kerb, course.ramp, course.cones]);
  const soupCoarse = meshToSoupEntries([coarse]);
  const grid = makeGdfGrid([soupFine, soupFine, soupCoarse]);

  // static cards by L0 cell for tile card lists
  const staticCardCells = new Map();
  {
    const clip = CLIPS[0];
    for (let i = 0; i < firstDynCard; i++) {
      const bb = cardWorldAABB(cardSystem.cards[i], null);
      const m = 0.40;
      const c0 = bb.min.map(v => Math.floor((v - m) / clip.cell));
      const c1 = bb.max.map(v => Math.floor((v + m) / clip.cell));
      for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) {
        const k = cellKey(x, y, z);
        let l = staticCardCells.get(k);
        if (!l) { l = []; staticCardCells.set(k, l); }
        l.push(i);
      }
    }
  }

  // ------------------------------------------------ gpu --------------------------------------------------
  const canvas = $("#glcanvas");
  const { device, context, format } = await requestGpu(canvas);
  const scene = { objects, renderStream, cardSystem, materials: MATERIALS };
  const gpu = new SdfGiGpu(device, context, format, scene);
  await gpu.build();

  // transforms upload (identities for statics once; dynamic every frame)
  const tfArray = new Float32Array(10 * 16);
  staticObjs.forEach(o => tfArray.set(mat4Identity(), o.tfIndex * 16));
  device.queue.writeBuffer(gpu.bTransforms, 0, tfArray);

  // static card world frames (identity) — uploaded once
  device.queue.writeBuffer(gpu.bCards, 0, packCardsWorld(cardSystem.perObj.filter(r => !r.obj.dynamic).flatMap(r => r.cards), 0));

  // ------------------------------------------------ sim + ui ---------------------------------------------
  const sim = makeSim(canvas);
  const ui = makeUi();

  // canvas + capture sizing follows the window (capture height is the internal render scale)
  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    const cw = Math.max(320, Math.round(box.width));
    const ch = Math.max(200, Math.round(box.height));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const capW = 960, capH = Math.max(300, Math.round(960 * ch / Math.max(1, cw)));
    if (gpu.captureSize[0] !== capW || gpu.captureSize[1] !== capH) gpu.setCaptureSize(capW, capH);
  }
  window.addEventListener("resize", resize);
  resize();

  // ------------------------------------------------ init passes -------------------------------------------
  {
    const enc = device.createCommandEncoder();
    gpu.encodeInit(enc);
    device.queue.submit([enc.finish()]);
  }

  // ------------------------------------------------ helpers -----------------------------------------------
  const wheelHubs = VehicleSpec.Hubs;
  function dynTransforms() {
    const v = sim.veh;
    const body = bodyOrigin(v);
    const bodyM = mat4FromYawPitchRoll(body, v.yaw, v.pitch, v.roll);
    console.assert(bodyM.length === 16);
    const out = [{ obj: dynObjs[0], m: bodyM }];
    for (let w = 0; w < 4; w++) {
      const h = VehicleSpec.Hubs[w];
      let m = mat4Multiply(bodyM, mat4Translate(h[0], h[1], h[2] - sim.veh.compression[w]));
      if (w < 2) m = mat4Multiply(m, mat4RotZ(sim.veh.steer));
      m = mat4Multiply(m, mat4RotY(sim.veh.wheelSpin));
      out.push({ obj: dynObjs[1 + w], m });
    }
    return out;
  }

  function objectAABB(obj, mat) {
    const p = obj.mesh.positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    // corners of the local bound, transformed
    const b = obj.mesh;
    const loL = obj._lo ?? (obj._lo = (() => { const a = [Infinity, Infinity, Infinity]; const b2 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], p[i + k]); b2[k] = Math.max(b2[k], p[i + k]); } return { a, b2 }; })());
    for (const cx of [loL.a[0], loL.b2[0]])
      for (const cy of [loL.a[1], loL.b2[1]])
        for (const cz of [loL.a[2], loL.b2[2]]) {
          const w = mat4TransformPoint(mat, [cx, cy, cz]);
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
        }
    return { min: lo, max: hi };
  }

  const frameU = new ArrayBuffer(352);
  const fF = new Float32Array(frameU);
  const fU = new Uint32Array(frameU);
  const fieldU = new ArrayBuffer(48);
  const fdF = new Float32Array(fieldU);
  const fdU = new Uint32Array(fieldU);
  const dynBuf = new ArrayBuffer(8 * 96);
  const dynF = new Float32Array(dynBuf);

  let prevViewProj = null, prevCam = [0, 0, 0];
  let lastT = performance.now();
  let planMsAvg = 0;

  // debug: expose for the console
  window.slate = { sim, gpu, grid, objects, cardSystem, course };

  function frame() {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    const tPlan0 = performance.now();

    // ---------------- sim ----------------
    const { manual } = stepSim(sim, dt);
    const dyn = dynTransforms();
    const bodyW = bodyOrigin(sim.veh);
    const focus = [bodyW[0], bodyW[1], Math.max(bodyW[2] + 0.4, 0.4)];

    // transforms
    for (const { obj, m } of dyn) tfArray.set(m, obj.tfIndex * 16);
    device.queue.writeBuffer(gpu.bTransforms, 0, tfArray);

    // dynamic cards -> world frames
    {
      const cardWrites = [];
      for (const { obj, m } of dyn) {
        const rec = cardSystem.perObj.find(r => r.obj === obj);
        cardWrites.push({ first: rec.firstCard, data: packCardsWorld(rec.cards, rec.firstCard, m) });
      }
      for (const w of cardWrites) device.queue.writeBuffer(gpu.bCards, w.first * 64, w.data);
    }

    // ---------------- gdf plan ----------------
    const dynAABBs = dyn.map(d => objectAABB(d.obj, d.m));
    const budgets = {
      alloc: [ui.budget.allocL0, ui.budget.allocL1, ui.budget.allocL2],
      rebuild: [ui.budget.rebuildL0, ui.budget.rebuildL1, ui.budget.rebuildL2],
    };
    const plan = planGdfFrame(grid, focus, dynAABBs, budgets);
    applyTableWrites(grid, plan.tableWrites);
    // uploads: table diffs
    for (const w of plan.tableWrites) {
      const off = (CLIPS[w.level].gridDim ** 3) * 2 * 0; // level offsets
      const base = (w.level === 0 ? 0 : w.level === 1 ? CLIPS[0].gridDim ** 3 : CLIPS[0].gridDim ** 3 + CLIPS[1].gridDim ** 3);
      const slot = base + w.slot;
      const rec = new Uint32Array([w.hash, w.pool1]);
      device.queue.writeBuffer(gpu.bTables, slot * 8, rec);
      void off;
    }
    // uploads: soup slices
    for (const s of plan.soupWrites) {
      if (s.data.length === 0) continue;
      const dst = Array.isArray(s.data) ? new Float32Array(s.data) : s.data;
      device.queue.writeBuffer(gpu.bSoup[s.level], s.pool * CLIPS[s.level].cap * 64, dst);
    }

    // ---------------- L0 card lists for new + car tiles ----------------
    {
      const writes = [];
      const handled = new Set();
      const doTile = (key, pool) => {
        if (handled.has(key)) return;
        handled.add(key);
        const z = key % 4096 - 2048, y = ((key / 4096) | 0) % 4096 - 2048, x = Math.floor(key / 16777216) - 2048;
        const center = [(x + 0.5) * CLIPS[0].cell, (y + 0.5) * CLIPS[0].cell, (z + 0.5) * CLIPS[0].cell];
        let ids = [];
        const st = staticCardCells.get(key);
        if (st) ids = ids.concat(st);
        if (grid.carCells[0].has(key)) {
          for (const { obj, m } of dyn) {
            const rec = cardSystem.perObj.find(r => r.obj === obj);
            for (let ci = 0; ci < rec.cards.length; ci++) {
              const bb = cardWorldAABB(rec.cards[ci], m);
              const cs = CLIPS[0].cell;
              if (bb.max[0] >= x * cs - 0.4 && bb.min[0] <= (x + 1) * cs + 0.4 &&
                  bb.max[1] >= y * cs - 0.4 && bb.min[1] <= (y + 1) * cs + 0.4 &&
                  bb.max[2] >= z * cs - 0.4 && bb.min[2] <= (z + 1) * cs + 0.4) ids.push(rec.firstCard + ci);
            }
          }
        }
        if (ids.length > 24) {
          ids.sort((a, b) => {
            const ca = cardSystem.cards[a], cb = cardSystem.cards[b];
            const da = Math.hypot(ca.org[0] - center[0], ca.org[1] - center[1], ca.org[2] - center[2]);
            const db = Math.hypot(cb.org[0] - center[0], cb.org[1] - center[1], cb.org[2] - center[2]);
            return da - db;
          });
          ids = ids.slice(0, 24);
        }
        writes.push({ pool, ids });
      };
      for (const j of plan.jobs[0]) doTile(j.key, j.pool);
      for (const k of grid.carCells[0]) {
        const rec = grid.levels[0].allocated.get(k);
        if (rec) doTile(k, rec.pool);
      }
      writes.sort((a, b) => a.pool - b.pool);
      for (const w of writes) {
        const capped = Math.min(w.ids.length, 24);
        const infoRec = new Uint32Array([w.pool * 24 | capped << 20]);
        device.queue.writeBuffer(gpu.bCardInfo, w.pool * 4, infoRec);
        const idArr = new Uint32Array(w.ids);
        device.queue.writeBuffer(gpu.bCardIds, w.pool * 24 * 4, idArr);
      }
    }

    // ---------------- voxel relight jobs ----------------
    const vxJobs = [];
    {
      const seen = new Set();
      for (const k of grid.carCells[0]) {
        const rec = grid.levels[0].allocated.get(k);
        if (rec && !seen.has(k) && vxJobs.length < ui.budget.vxCar) {
          seen.add(k);
          const z = k % 4096 - 2048, y = ((k / 4096) | 0) % 4096 - 2048, x = Math.floor(k / 16777216) - 2048;
          vxJobs.push({ cell: [x, y, z], pool: rec.pool });
        }
      }
      // rotating fresh fill of everything else
      let budget = ui.budget.vxTotal - vxJobs.length;
      const alloc = [...grid.levels[0].allocated.entries()];
      for (let k = 0; k < alloc.length && budget > 0; k++) {
        const [key, rec] = alloc[(k + gpu.frame * 13) % alloc.length];
        if (seen.has(key)) continue;
        seen.add(key); budget--;
        const z = key % 4096 - 2048, y = ((key / 4096) | 0) % 4096 - 2048, x = Math.floor(key / 16777216) - 2048;
        vxJobs.push({ cell: [x, y, z], pool: rec.pool });
      }
    }

    // ---------------- frame/field uniforms ----------------
    const { viewProj } = viewSim(sim, gpu.captureSize[0] / gpu.captureSize[1]);
    const inv = mat4Invert(viewProj);
    prevViewProj = prevViewProj ?? viewProj;
    fF.set(viewProj, 0);
    fF.set(inv, 16);
    fF.set(prevViewProj, 32);
    fF.set([sim.eye[0], sim.eye[1], sim.eye[2], 1], 48);
    fF.set([prevCam[0], prevCam[1], prevCam[2], 1], 52);
    const sunEl = (ui.sun.elev * Math.PI) / 180, sunAz = (ui.sun.azim * Math.PI) / 180;
    const sunD = [Math.cos(sunEl) * Math.cos(sunAz), Math.cos(sunEl) * Math.sin(sunAz), Math.sin(sunEl)];
    fF.set([sunD[0], sunD[1], sunD[2], 0], 56);
    fF.set([ui.sun.intensity, ui.sun.intensity * 0.96, ui.sun.intensity * 0.9, ui.sun.exposure], 60);
    fF.set([0.42, 0.55, 0.68, sim.t], 64);
    fF.set([0.10, 0.24, 0.55, ui.sun.gi], 68);
    fF.set([gpu.captureSize[0], gpu.captureSize[1], 1 / gpu.captureSize[0], 1 / gpu.captureSize[1]], 72);
    fF.set([canvas.width, canvas.height, 1 / canvas.width, 1 / canvas.height], 76);
    const flags = (ui.stage.surfaceCache ? 4 : 0) | (ui.stage.voxelLight ? 8 : 0) | (ui.stage.finalGather ? 16 : 0) | (ui.stage.history ? 0 : 32);
    fU.set([gpu.frame, ui.viewMode, (Math.random() * 65536) | 0, flags], 80);
    fF.set([ui.sliceZ, ui.stage.smallEmissive ? 1 : 0, 0, 0], 84);
    device.queue.writeBuffer(gpu.bFrame, 0, frameU);

    fdF.set([focus[0], focus[1], focus[2], grid.epoch], 0);
    fdU.set([CLIPS[0].poolSize, 0, 0, 0], 4);
    fdU.set([0, 0, 0, 0], 8);
    device.queue.writeBuffer(gpu.bField, 0, fieldU);

    // dyn objects for gdf_build
    {
      dynF.fill(0);
      dyn.forEach((d, i) => {
        const invM = mat4Invert(d.m);
        const rows = [
          [invM[0], invM[4], invM[8], invM[12]],
          [invM[1], invM[5], invM[9], invM[13]],
          [invM[2], invM[6], invM[10], invM[14]],
        ];
        const o = i * 24;
        dynF.set(rows[0], o); dynF.set(rows[1], o + 4); dynF.set(rows[2], o + 8); dynF.set([0, 0, 0, 0], o + 12);
        const sdf = d.obj.sdf ?? dynObjs[1].sdf;          // wheels FR/RL/RR share the wheelFL SDF record
        if (sdf) {
          const lo = sdf.lo, invVox = sdf.invVox;
          const AD = sdf.atlasDims, AB = sdf.atlasBase;
          dynF.set([invVox[0] / AD[0], invVox[1] / AD[1], invVox[2] / AD[2], 1], o + 16);
          dynF.set([(AB[0] - lo[0] * invVox[0]) / AD[0], (AB[1] - lo[1] * invVox[1]) / AD[1], (AB[2] - lo[2] * invVox[2]) / AD[2], 0], o + 20);
        }
      });
      device.queue.writeBuffer(gpu.bDyn, 0, dynBuf);
    }

    // relight rows for dynamic cards
    const dynRow0 = Math.floor(firstDynCard / 128) * 8;
    const dynRowCount = Math.ceil((firstDynCard + dynCardCount) / 128) * 8 - dynRow0;

    // composite SDF view cfg
    {
      const cfg = new ArrayBuffer(128);
      const cf = new Float32Array(cfg);
      const bodyInv = mat4Invert(dyn[0].m);
      const b = dyn[0].obj;
      cf.set([bodyInv[0], bodyInv[4], bodyInv[8], bodyInv[12]], 0);
      cf.set([bodyInv[1], bodyInv[5], bodyInv[9], bodyInv[13]], 4);
      cf.set([bodyInv[2], bodyInv[6], bodyInv[10], bodyInv[14]], 8);
      cf.set(b.sdf.lo, 16); cf.set([0], 19);
      cf.set(b.sdf.invVox, 20); cf.set([0], 23);
      device.queue.writeBuffer(gpu.bSdfView, 0, cfg);
    }

    // ---------------- submit ----------------
    const tPlan1 = performance.now();
    planMsAvg = planMsAvg * 0.95 + (tPlan1 - tPlan0) * 0.05;
    gpu.frame({
      jobs: plan.jobs, dynCount: dyn.length, frameIdx: gpu.frame,
      dynRow0, dynRowCount, vxJobs,
    }, {
      meshSdf: ui.stage.meshSdf, gdf: ui.stage.gdf, cards: ui.stage.cards,
      surfaceCache: ui.stage.surfaceCache, voxelLight: ui.stage.voxelLight,
    });

    prevViewProj = viewProj;
    prevCam = [...sim.eye];

    // ---------------- hud ----------------
    frameStats(ui, dt, sim, plan, grid, planMsAvg);
    if (ui.autopilot === false && !manual) sim.ap.pauseT = 1e9;
    else if (ui.autopilot) sim.ap.pauseT = 0;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#f87171;font:14px monospace;background:#0a0c10;padding:40px;text-align:center;z-index:99";
  el.textContent = "Slate SDF GI failed to start (WebGPU required): " + (e.message ?? e);
  document.body.appendChild(el);
});
