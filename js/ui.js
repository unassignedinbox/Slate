//============================================================================================================================================
//                                                                UI.JS
//============================================================================================================================================
// 📦 HUD + sidebar. Every control is live: view modes, sun, stage enables (each one really gates its GPU
//    pass), frame budgets (how many GDF tiles / surface rows / voxel tiles update), and the documented
//    "small emissive meshes" Lumen-Scene inclusion switch.

export function makeUi() {
  const ui = {
    viewMode: 0,
    sliceZ: 0.45,
    stage: { meshSdf: true, gdf: true, cards: true, surfaceCache: true, voxelLight: true, finalGather: true, smallEmissive: true, history: true },
    budget: { allocL0: 48, allocL1: 12, allocL2: 8, rebuildL0: 48, rebuildL1: 12, rebuildL2: 8, vxCar: 20, vxTotal: 32 },
    sun: { elev: 52, azim: 128, intensity: 26, exposure: 1.0, gi: 1.0 },
    autopilot: true,
  };

  const $ = (q) => document.querySelector(q);
  const bindCheck = (id, obj, key) => {
    const el = $(id);
    el.checked = obj[key];
    el.addEventListener("change", () => { obj[key] = el.checked; });
  };
  const bindRange = (id, obj, key, fmt = (v) => v) => {
    const el = $(id), out = $(id + "-val");
    const apply = () => { obj[key] = parseFloat(el.value); if (out) out.textContent = fmt(obj[key]); };
    el.addEventListener("input", apply); apply();
  };

  bindCheck("#ck-meshsdf", ui.stage, "meshSdf");
  bindCheck("#ck-gdf", ui.stage, "gdf");
  bindCheck("#ck-cards", ui.stage, "cards");
  bindCheck("#ck-sc", ui.stage, "surfaceCache");
  bindCheck("#ck-vox", ui.stage, "voxelLight");
  bindCheck("#ck-fg", ui.stage, "finalGather");
  bindCheck("#ck-emissive", ui.stage, "smallEmissive");
  bindCheck("#ck-autopilot", ui, "autopilot");

  bindRange("#rg-sunelev", ui.sun, "elev", (v) => v.toFixed(0) + "°");
  bindRange("#rg-sunazim", ui.sun, "azim", (v) => v.toFixed(0) + "°");
  bindRange("#rg-sunint", ui.sun, "intensity", (v) => v.toFixed(1));
  bindRange("#rg-exposure", ui.sun, "exposure", (v) => v.toFixed(2));
  bindRange("#rg-gi", ui.sun, "gi", (v) => v.toFixed(2));
  bindRange("#rg-slice", ui, "sliceZ", (v) => v.toFixed(2) + " m");
  bindRange("#rg-alloc", ui.budget, "allocL0", (v) => v.toFixed(0));
  bindRange("#rg-vx", ui.budget, "vxTotal", (v) => v.toFixed(0));

  const sel = $("#select-viewmode");
  sel.addEventListener("change", () => { ui.viewMode = parseInt(sel.value, 10); });
  window.addEventListener("keydown", (e) => {
    const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7 };
    if (map[e.code] !== undefined) { ui.viewMode = map[e.code]; sel.value = String(ui.viewMode); }
  });

  return ui;
}

const VIEW_NAMES = ["Full composite", "Indirect GI only", "Direct only", "Surface cache atlas",
  "Global distance field", "Body mesh SDF", "Voxel lighting", "Mesh cards", "World normals", "Depth"];

export function frameStats(ui, dt, sim, plan, grid, planMs) {
  const $ = (q) => document.querySelector(q);
  ui._acc = (ui._acc ?? 0) + dt; ui._n = (ui._n ?? 0) + 1;
  if (!ui._statT || performance.now() - ui._statT > 250) {
    const fps = 1 / Math.max(ui._acc / ui._n, 1e-4);
    ui._acc = 0; ui._n = 0; ui._statT = performance.now();
    $("#hud-fps").textContent = fps.toFixed(1);
    $("#hud-frametime").textContent = (dt * 1000).toFixed(1) + " ms";
    $("#hud-speed").textContent = (Math.abs(sim.veh.vLong) * 3.6).toFixed(0) + " km/h" + (sim.mode === "free" ? " (free cam)" : "");
    $("#hud-mode").textContent = VIEW_NAMES[ui.viewMode] ?? "Full";
    $("#hud-plan").textContent = planMs.toFixed(2) + " ms";
    $("#hud-tiles").textContent = grid.levels.map((l, i) => `L${i}:${l.allocated.size}`).join("  ");
    const rebuilt = plan.jobs.reduce((a, j) => a + j.length, 0);
    $("#hud-rebuilt").textContent = `${rebuilt} (${plan.jobs.map(j => j.length).join("/")})`;
  }
}
