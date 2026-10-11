import {
  heightOf,
  roadLevels,
  liftRoad,
  roadElevation,
  isElevated,
  landingRun,
} from "./road-elevation.js";
import {
  DEFAULT_BRIDGE_BLEND,
  DEFAULT_BRIDGE_GRADE,
} from "./bridge-profile.js";
import { createIcons, icons } from "lucide";
import "@fontsource-variable/dm-sans/wght.css";
import "./style.css";
import {
  PAVING_PATTERNS,
  streetSettings,
  DEFAULT_DRIVEWAY,
} from "./street-settings.js";
import { pavingCanvases } from "./paving.js";
import { DEFAULT_HUMP, humpSpec } from "./traffic-calming.js";
import {
  preset,
  sampleRoad,
  addCurve,
  reconcileIntersections,
  snapRoadDrawingPoint,
  validateModel,
  moveJunction,
} from "./network.js";
import { snapConnection, moveConnectionEnd } from "./connections.js";
import { createScene } from "./scene.js";
const $ = (s) => document.querySelector(s),
  icon = (n, c = "") => `<i data-lucide="${n}" class="${c}"></i>`;
const iconize = () => createIcons({ icons, attrs: { "stroke-width": 1.5 } });
let inspectorSection = "geometry",
  drawKind = "asphalt",
  drawElevation = 0;
let model = preset(),
  selected = null,
  tool = "select",
  tab = "network",
  assetTab = "Networks",
  paused = false,
  history = [],
  future = [],
  drawPoints = [],
  scene,
  dirty = false;
try {
  const stored =
    sessionStorage.getItem("slate-recovery") ||
    localStorage.getItem("slate-project");
  if (stored) model = validateModel(JSON.parse(stored));
  else if (
    ["parks", "bridges"].includes(
      new URLSearchParams(location.search).get("demo"),
    )
  )
    model = preset(new URLSearchParams(location.search).get("demo"));
  sessionStorage.removeItem("slate-recovery");
} catch {}
const layerDefs = [
  ["roads", "route", "Road network"],
  ["markings", "align-center", "Road markings"],
  ["sidewalks", "grid-2x2", "Pavements"],
  ["curbs", "square-dashed", "Curbs & edges"],
  ["landscape", "trees", "Landscape"],
  ["lights", "lamp-floor", "Street lighting"],
  ["bollards", "columns-3", "Bollards"],
  ["traffic", "car-front", "Traffic simulation"],
  ["calming", "waves", "Traffic calming"],
  ["crossings", "footprints", "Crosswalks"],
  ["ramps", "accessibility", "Pedestrian ramps"],
  ["driveways", "car-front", "Vehicle crossovers"],
  ["walkways", "footprints", "Park walkways"],
  ["bridges", "waypoints", "Bridges & elevated roads"],
  ["drainage", "list-filter", "Drainage channels"],
  ["manholes", "circle-dot", "Manhole covers"],
];
$("#app").innerHTML = `
<header class="app-header"><a class="brand" href="./" aria-label="Slate Road Studio"><span class="brand-mark">${icon("layers-2")}</span>slate<span class="brand-divider"></span><span class="brand-caption">ROAD STUDIO</span></a><nav class="main-menu"><button id="file-menu">File</button><button id="undo">Edit</button><button id="view-menu">View</button><button id="help">Help</button></nav><div class="project-title"><span class="save-dot"></span><span id="project-name"></span>${icon("chevron-down")}</div><div class="header-actions"><span class="version">EXPERIMENTAL <b>0.7</b></span><button id="save" class="header-save" title="Save project to this browser">${icon("save")} Save</button><button id="export" class="export-button">${icon("upload")} Export ${icon("chevron-down")}</button></div></header>
<div class="workspace-bar"><div class="workspace-title">${icon("route")} Road workspace <span class="divider"></span><span class="muted">Scene 01</span></div><div class="workspace-tabs"><button class="active" data-workspace="layout">${icon("spline")} Layout</button><button data-workspace="materials">${icon("layers")} Materials</button><button data-workspace="simulate">${icon("play")} Simulate</button></div><button class="icon-button" id="settings" title="Workspace settings">${icon("sliders-horizontal")}</button></div>
<main class="editor"><section class="center"><div class="viewport" id="viewport"><div class="viewport-top"><div class="view-pills"><button id="perspective">${icon("box")} Perspective ${icon("chevron-down")}</button><span class="pill-line"></span><button id="shading">Lit ${icon("chevron-down")}</button><button id="fly-status" title="Hold right mouse to look. WASD fly, Q/E down/up, Shift faster, wheel changes speed.">RMB + WASD · Fly</button></div><div class="render-badge"><span class="live-dot"></span><span id="backend">INITIALIZING</span></div></div>
<div class="tools"><button class="active" data-tool="select" title="Select (V)">${icon("mouse-pointer-2")}<kbd>V</kbd></button><button data-tool="move" title="Move junction (G)">${icon("move")}<kbd>G</kbd></button><div></div><button data-tool="draw" title="Draw a quadratic road (B)">${icon("spline")}<kbd>B</kbd></button><button id="frame" title="Frame network (F)">${icon("scan")}</button><button id="street-view" title="Street-level curb and ramp inspection">${icon("person-standing")}</button><div></div><button id="grid" title="Toggle metre grid">${icon("grid-3x3")}</button><button id="wire" title="Show triangulated surface topology">${icon("boxes")}</button><div></div><button id="undo-tool" title="Undo (Ctrl Z)">${icon("undo-2")}</button><button id="redo-tool" title="Redo (Ctrl Shift Z)">${icon("redo-2")}</button></div>
<div class="scene-heading"><div class="eyebrow">PROCEDURAL ROAD NETWORK</div><h1 id="scene-name"></h1><p>Real dimensions. Connected by design.</p></div>
<div class="axis-widget"><span class="axis-y">Y</span><span class="axis-z">Z</span><span class="axis-x">X</span><b></b><small>WORLD</small></div>
<div class="viewport-bottom"><div class="navigation-help">${icon("mouse")} <span>LMB orbit · MMB pan</span><b>·</b><span>RMB + WASD fly · Q/E down/up</span></div><div class="scale"><span>20 m</span><div></div><small>METRIC</small></div></div>
<div class="connection-author"><select id="draw-kind" aria-label="Connection type"><option value="asphalt">Asphalt road</option><option value="roadbridge">Network bridge road</option><option value="walkway">Park walkway</option><option value="concrete">Concrete access road</option><option value="bridge">Legacy park footbridge</option></select><label title="Construction elevation above ground">Y <input id="draw-elevation" aria-label="Draw elevation" type="number" value="0" min="0" max="40" step="0.25"> m</label><button id="draw-connection">${icon("plus")} Draw</button></div><div id="tool-hint" class="tool-hint hidden"></div><div id="loading" class="loading"><span class="spinner"></span>Preparing your road workspace…</div></div>
<section class="asset-browser"><div class="browser-header"><div class="browser-tabs"><button class="active" data-asset="Networks">Network library</button><button data-asset="Details">Street details</button><button data-asset="Surfaces">Surfaces</button></div><div class="browser-right"><span>PROCEDURAL ASSETS</span><button id="collapse-assets" class="icon-button" title="Collapse library">${icon("chevron-down")}</button></div></div><div class="asset-content"><div class="asset-intro"><div class="eyebrow" id="asset-eyebrow">START WITH A NETWORK</div><h3 id="asset-heading">A foundation for<br>every journey.</h3><p id="asset-description">Choose a layout. Make it your own.</p><button id="new-network">${icon("plus")} Empty project</button></div><div class="asset-cards" id="asset-cards"></div></div></section></section>
<aside class="sidebar"><div class="panel-tabs"><button class="active" data-tab="network">${icon("layers-2")} Layers</button><button data-tab="materials">${icon("swatch-book")} Materials</button><button id="add-layer" class="icon-button" title="Add road">${icon("plus")}</button></div><div class="outliner"><div class="section-heading"><span id="layer-heading">SCENE COLLECTION</span><span id="layer-count">8 LAYERS</span></div><div class="collection-row">${icon("chevron-down")}${icon("folder-open")}<strong>Road network</strong><span class="tag">LIVE</span></div><div id="layer-list"></div><button class="add-layer" id="draw-road">${icon("plus")} Draw a road <kbd>B</kbd></button></div><div class="inspector-header"><span>${icon("sliders-horizontal")} Inspector</span><span id="inspector-context">NETWORK</span></div><div class="inspector" id="inspector"></div><div class="sidebar-footer"><span class="live-dot"></span><span>Non-destructive workflow</span>${icon("shield-check")}</div></aside></main>
<footer class="statusbar"><div><span class="live-dot"></span><span id="status">Ready</span><span class="status-separator">/</span><span id="road-count"></span><span id="junction-count"></span></div><div><span id="mesh-stat"></span><span class="status-separator">|</span><span id="fps">— FPS</span><span class="status-separator">|</span><span>1 unit = 1 meter</span>${icon("check-check")}</div></footer><div id="toast" role="status"></div><dialog id="dialog"></dialog><input type="file" id="import-input" accept=".json,.slate" hidden>`;
function names() {
  $("#project-name").textContent = model.name;
  $("#scene-name").textContent = model.name;
}
names();
function layers() {
  if (tab === "materials") {
    $("#layer-heading").textContent = "SURFACE STACK";
    $("#layer-count").textContent = "3 MATERIALS";
    $("#layer-list").innerHTML = [
      ["roads", "layers", "Asphalt · base surface"],
      ["markings", "paintbrush", "Thermoplastic · markings"],
      ["sidewalks", "grid-2x2", "Concrete · paving"],
    ]
      .map(
        ([k, i, label], idx) =>
          `<div class="layer-row ${idx === 0 ? "selected" : ""}" data-material="${k}"><span class="material-swatch swatch-${k}"></span><span>${label}</span><button class="visibility" data-visibility="${k}" title="Toggle ${label}">${icon(model.layers[k] ? "eye" : "eye-off")}</button></div>`,
      )
      .join("");
  } else {
    $("#layer-heading").textContent = "SCENE COLLECTION";
    $("#layer-count").textContent = `${layerDefs.length} LAYERS`;
    $("#layer-list").innerHTML = layerDefs
      .map(
        ([k, i, name], idx) =>
          `<div class="layer-row ${k === "roads" ? "selected" : ""} ${!model.layers[k] ? "disabled" : ""}" data-layer="${k}"><span class="tree-branch"></span>${icon(i)}<span>${name}</span><small>${k === "roads" ? model.roads.length : k === "traffic" ? model.traffic : ""}</small><button class="visibility" data-visibility="${k}" title="${model.layers[k] ? "Hide" : "Show"} ${name}">${icon(model.layers[k] ? "eye" : "eye-off")}</button></div>`,
      )
      .join("");
  }
  if (tab !== "materials")
    $("#layer-list").insertAdjacentHTML(
      "beforeend",
      (model.connections || [])
        .map(
          (c, i) =>
            `<div class="layer-row ${selected === c.id ? "selected" : ""}" data-connection="${encodeURIComponent(c.id)}"><span class="tree-branch"></span>${icon(c.kind === "bridge" ? "waypoints" : "footprints")}<span>${c.kind === "bridge" ? "Park bridge" : "Walkway"} ${i + 1}</span><small>${c.width} m</small></div>`,
        )
        .join(""),
    );
  iconize();
}
const range = (id, label, value, min, max, step = 1, unit = "") =>
  `<label class="range-field"><span>${label}<output id="${id}-value">${value}<small> ${unit}</small></output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="--progress:${((value - min) / (max - min)) * 100}%"></label>`;
const toggle = (id, label, on, sub = "") =>
  `<label class="toggle-field"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input id="${id}" type="checkbox" ${on ? "checked" : ""}><span class="switch"></span></label>`;
function propertyCards(root) {
  if (!root) return;
  for (const heading of [...root.children].filter((el) =>
    el.classList.contains("section-heading"),
  )) {
    const card = document.createElement("section");
    card.className = "property-card";
    root.insertBefore(card, heading);
    let el = heading;
    while (
      el &&
      !(el !== heading && el.classList.contains("section-heading"))
    ) {
      const next = el.nextElementSibling;
      card.append(el);
      el = next;
    }
  }
}
function humpControls(road) {
  const heading = `<div class="section-heading top-border"><span>TRAFFIC CALMING</span><span>01 / SPEED HUMP</span></div>`;
  if (!road)
    return (
      heading +
      `<div class="info-note">${icon("mouse-pointer-2")}Select a road in the viewport to add a raised speed hump.</div>`
    );
  const spec = humpSpec(
    { ...road, speedHump: road.speedHump || DEFAULT_HUMP },
    { ...model, layers: { ...model.layers, calming: true } },
  );
  return (
    heading +
    toggle(
      "hump-enabled",
      "Raised speed hump",
      !!road.speedHump,
      "Cosine profile · approach chevrons",
    ) +
    (road.speedHump
      ? range(
          "hump-height",
          "Height",
          Math.round(road.speedHump.height * 1000),
          50,
          120,
          5,
          "mm",
        ) +
        range(
          "hump-length",
          "Length",
          road.speedHump.length,
          2.5,
          5,
          0.1,
          "m",
        ) +
        range(
          "hump-position",
          "Along road",
          Math.round(road.speedHump.position * 100),
          15,
          85,
          1,
          "%",
        )
      : "") +
    `<div class="info-note" id="hump-status">${icon(spec ? "check-circle-2" : "triangle-alert")}${spec ? `Placement at ${spec.center.toFixed(1)} m; ${spec.height * 1000} mm raised profile. Vehicles slow to 12 km/h. ${model.layers.calming === false ? "Traffic calming layer is hidden." : ""}` : "This segment is too short for the hump and its approach clearances. Geometry is suppressed."}</div>`
  );
}
function addHump() {
  const r = model.roads.find((r) => r.id === selected);
  if (!r) return toast("Select a road first, then add a speed hump.");
  if (
    !humpSpec(
      { ...r, speedHump: DEFAULT_HUMP },
      { ...model, layers: { ...model.layers, calming: true } },
    )
  )
    return toast("Choose a longer road: approach clearances are required.");
  mutate(() => {
    r.speedHump = { ...DEFAULT_HUMP };
    model.layers.calming = true;
  });
  setTab("network");
  inspector("details");
  toast("Raised speed hump added to selected road");
}
function vehicleControls(road) {
  const heading = `<div class="section-heading top-border"><span>VEHICLE CROSSOVER</span><span>SELECTED ROAD</span></div>`;
  if (!road)
    return (
      heading +
      `<div class="info-note">${icon("mouse-pointer-2")}Select a road to add a driveway apron. Pedestrian crossings above are separate network features.</div>`
    );
  const d = road.driveway || DEFAULT_DRIVEWAY,
    required = d.run + 1.0,
    placed = scene?.streetscape.vehicleRoads?.includes(road.id);
  return (
    heading +
    toggle(
      "driveway-enabled",
      "Dropped-kerb vehicle entry",
      !!road.driveway,
      "Apron + continuous level footway behind",
    ) +
    (road.driveway
      ? `<label class="property">Side <select id="driveway-side"><option value="1" ${d.side === 1 ? "selected" : ""}>Right (A → B)</option><option value="-1" ${d.side === -1 ? "selected" : ""}>Left (A → B)</option></select></label>${range("driveway-width", "Entry width", d.width, 3, 7, 0.5, "m")}${range("driveway-run", "Apron run", d.run, 1.5, 3, 0.1, "m")}${range("driveway-position", "Along road", Math.round(d.position * 100), 15, 85, 1, "%")}`
      : "") +
    (model.sidewalk < required
      ? `<button id="driveway-widen" class="wide-button">${icon("expand")} Widen to ${Math.max(3.2, required).toFixed(1)} m + add</button>`
      : "") +
    `<div class="info-note" id="driveway-status">${icon(road.driveway && !placed ? "triangle-alert" : "info")}${road.driveway ? (placed ? "Vehicle apron placed. A level pedestrian strip is retained behind it." : model.layers.driveways === false ? "Vehicle crossovers layer is off. Enable it in the layer stack." : "Not placed: check pavement width, road ends and crossing conflicts below.") : "Adds one vehicle access on this road, not a pedestrian ramp."} This does not add a traffic route into the plot. Local driveway approval and vehicle clearance checks are still required.</div>`
  );
}
function bindVehicle(road) {
  if (!road) return;
  $("#driveway-enabled").onchange = (e) =>
    mutate(() => {
      if (e.target.checked) {
        road.driveway = { ...DEFAULT_DRIVEWAY };
        model.layers.driveways = true;
      } else delete road.driveway;
    });
  if (road.driveway) {
    bindRange("driveway-width", (v) => (road.driveway.width = v));
    bindRange("driveway-run", (v) => (road.driveway.run = v));
    bindRange("driveway-position", (v) => (road.driveway.position = v / 100));
    $("#driveway-side").onchange = (e) =>
      mutate(() => (road.driveway.side = Number(e.target.value)));
  }
  if ($("#driveway-widen"))
    $("#driveway-widen").onclick = () =>
      mutate(() => {
        const d = road.driveway || { ...DEFAULT_DRIVEWAY };
        model.sidewalk = Math.max(3.2, d.run + 1);
        road.driveway = d;
        model.layers.driveways = true;
      });
}
function bridgeProfilePanel(result) {
  if (!result?.valid) return "";
  const points = result.profile,
    span = result.length,
    rise = Math.max(1, ...points.map((p) => p[1] - 0.27)),
    x = (s) => 16 + (232 * s) / span,
    y = (h) => 88 - (68 * (h - 0.27)) / rise;
  const line = points
      .map((p) => `${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`)
      .join(" "),
    corridor = result.protectedRange;
  const label = `Longitudinal bridge profile. ${span.toFixed(1)} metres long, ${(result.grade * 100).toFixed(1)} percent peak centreline grade.`;
  return `<div class="bridge-profile" id="bridge-profile"><div class="section-heading"><span>LONGITUDINAL PROFILE</span><span>VERTICAL EXAGGERATION</span></div><svg viewBox="0 0 264 116" role="img" aria-label="${label}"><title>${label}</title>${corridor ? `<rect x="${x(corridor[0])}" y="16" width="${x(corridor[1]) - x(corridor[0])}" height="72" fill="#626b75" opacity=".24"/>` : ""}<path d="M16 88 H248" stroke="#646464" stroke-dasharray="3 3"/><polygon points="16,88 ${line} 248,88" fill="#b7c1cd" opacity=".12"/><polyline points="${line}" fill="none" stroke="#d6dde4" stroke-width="1.8"/><text x="16" y="108">0 m</text><text x="248" y="108" text-anchor="end">${span.toFixed(1)} m</text><text x="16" y="12">${rise.toFixed(2)} m rise</text></svg><div class="bridge-readouts"><div><strong>${(result.grade * 100).toFixed(1)}%</strong><small>Peak centreline grade</small></div><div><strong>${result.clearance === null ? "—" : result.clearance.toFixed(2) + " m"}</strong><small>Nominal road clearance</small></div></div>${result.approaches.map((p, i) => `<div class="bridge-approach"><strong>${i ? "End" : "Start"}</strong><span>${p.run.toFixed(1)} m run · ${p.blend.toFixed(1)} m blend${p.additionalRun > 0.01 ? `<small>Needs +${p.additionalRun.toFixed(1)} m to meet grade target</small>` : ""}</span></div>`).join("")}<p>Targets flag problems; they do not move endpoints. Shading marks the protected road/pavement corridor. Clearance assumes the flat road level, not a swept-vehicle or load check.</p></div>`;
}
function connectionInspector(c) {
  const result = scene?.connections.bridges.find((b) => b.id === c.id),
    warnings = scene?.connections.warnings.filter((w) => w.id === c.id) || [];
  $("#inspector-context").textContent =
    c.kind === "bridge" ? "PARK BRIDGE" : "WALKWAY";
  $("#inspector").innerHTML =
    `<div class="object-heading"><span class="object-icon">${icon(c.kind === "bridge" ? "waypoints" : "footprints")}</span><div><h2>${c.kind === "bridge" ? "Park bridge" : "Park walkway"}</h2><p>${c.kind === "bridge" ? "Vehicle-width pedestrian deck" : "Connected paving surface"}</p></div></div><div class="section-heading"><span>PROFILE</span><span>METRES</span></div>${range("link-width", c.kind === "bridge" ? "Clear deck width" : "Path width", c.width, c.kind === "bridge" ? 4 : 1.5, 10, 0.25, "m")}${c.kind === "bridge" ? range("link-height", "Deck rise", c.height, 1, 12, 0.25, "m") + `<div class="section-heading top-border"><span>APPROACH DESIGN</span></div>` + range("link-grade-target", "Target grade", Math.round((c.gradeTarget ?? DEFAULT_BRIDGE_GRADE) * 1000) / 10, 2, 15, 0.1, "%") + range("link-transition", "Toe / crest blend", c.transition ?? DEFAULT_BRIDGE_BLEND, 1, 12, 0.5, "m") + range("link-clearance-target", "Road clearance target", c.clearanceTarget ?? 5, 2, 10, 0.25, "m") + bridgeProfilePanel(result) : ""}<div class="section-heading top-border"><span>ENDPOINTS</span></div>${[
      0, 1,
    ]
      .map((end) => {
        const p = end ? c.points.at(-1) : c.points[0];
        return `<label class="property">${end ? "End" : "Start"} X <input id="link-${end}-x" type="number" step=".5" value="${p[0].toFixed(2)}"></label><label class="property">${end ? "End" : "Start"} Z <input id="link-${end}-z" type="number" step=".5" value="${p[1].toFixed(2)}"></label>`;
      })
      .join(
        "",
      )}${result?.valid ? `<div class="info-note">${result.length.toFixed(1)} m route · ${(result.grade * 100).toFixed(1)}% peak centreline grade</div>` : ""}${warnings.map((w) => `<div class="info-note design-warning">${icon("triangle-alert")}${w.message}</div>`).join("")}<div class="info-note">${c.kind === "bridge" ? "Closed concrete deck, 1.3 m rails and park-side supports. Width does not imply a vehicle load rating. Approaches, road clearance and accessibility require project-specific review. No AI traffic is routed onto this bridge." : "Paving merges into level sidewalks. Draw to the back of a level footway, away from dropped crossing landings. A path crossing a carriageway is rejected; use a bridge instead."}</div><button id="focus-link" class="wide-button">${icon("scan")} Frame connection</button><button id="delete-link" class="wide-button">${icon("trash-2")} Delete connection</button>`;
  bindRange("link-width", (v) => (c.width = v));
  if (c.kind === "bridge") {
    bindRange("link-height", (v) => (c.height = v));
    bindRange("link-grade-target", (v) => (c.gradeTarget = v / 100));
    bindRange("link-transition", (v) => (c.transition = v));
    bindRange("link-clearance-target", (v) => (c.clearanceTarget = v));
  }
  for (const end of [0, 1])
    for (const axis of ["x", "z"])
      $(`#link-${end}-${axis}`).onchange = (e) => {
        const value = Number(e.target.value),
          p = end ? c.points.at(-1) : c.points[0];
        if (!Number.isFinite(value) || Math.abs(value) > 9999)
          return toast("Use a finite coordinate within ±9999 m");
        mutate(() =>
          moveConnectionEnd(
            c,
            end,
            axis === "x" ? value : p[0],
            axis === "z" ? value : p[1],
          ),
        );
      };
  $("#focus-link").onclick = () => {
    topView = false;
    scene.focus(c.id);
    $("#perspective").innerHTML =
      icon("box") + "Perspective" + icon("chevron-down");
    iconize();
  };
  $("#delete-link").onclick = () =>
    mutate(() => {
      model.connections = model.connections.filter((l) => l.id !== c.id);
      selected = null;
    });
  iconize();
}
function inspector(section = inspectorSection) {
  inspectorSection = section;
  const connection = model.connections?.find((c) => c.id === selected);
  if (connection && tab !== "materials") {
    connectionInspector(connection);
    return;
  }
  const node = model.nodes.find((n) => n.id === selected),
    road = model.roads.find((r) => r.id === selected);
  $("#inspector-context").textContent =
    tab === "materials"
      ? "SURFACE"
      : node
        ? "JUNCTION"
        : road
          ? "ROAD SEGMENT"
          : "NETWORK";
  if (tab === "materials") {
    $("#inspector").innerHTML =
      `<div class="object-heading"><span class="object-icon material-object">${icon("layers")}</span><div><h2>Road surfaces</h2><p>Physically based materials</p></div><span class="tag">PBR</span></div><div class="material-preview"><div></div><span>01 / Asphalt aggregate</span></div><div class="section-heading"><span>BASE SURFACE</span>${icon("chevron-up")}</div><label class="property">Albedo <input type="color" id="asphalt-color" value="${model.materials.asphalt}"></label>${range("roughness", "Roughness", model.materials.roughness, 0.1, 1, 0.01)}<div class="section-heading top-border"><span>PAVEMENT FINISH</span>${icon("chevron-up")}</div><label class="property">Pattern <select id="paving-pattern">${PAVING_PATTERNS.map((name) => `<option ${model.materials.paving === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>${range("paving-scale", "Module scale", model.materials.pavingScale, 0.5, 2, 0.1, "×")}${range("paving-rotation", "Pattern rotation", model.materials.pavingRotation, 0, 90, 5, "°")}<label class="property">Stone tint <input id="paving-color" type="color" value="${model.materials.pavingColor}"></label><div class="info-note">${icon("info")}100 × 200 mm pavers at 1×; 600 mm slabs for large format. Mortar joints use a relief map. Pattern scale and orientation continue through ramp inserts.</div>`;
    bindRange("roughness", (v) => (model.materials.roughness = v));
    $("#asphalt-color").onchange = (e) =>
      mutate(() => (model.materials.asphalt = e.target.value));
    $("#paving-pattern").onchange = (e) =>
      mutate(() => (model.materials.paving = e.target.value));
    bindRange("paving-scale", (v) => (model.materials.pavingScale = v));
    bindRange("paving-rotation", (v) => (model.materials.pavingRotation = v));
    $("#paving-color").onchange = (e) =>
      mutate(() => (model.materials.pavingColor = e.target.value));
    propertyCards($("#inspector"));
    iconize();
    return;
  }
  $("#inspector").innerHTML =
    `<div class="object-heading"><span class="object-icon">${icon(node ? "move" : road ? "spline" : "route")}</span><div><h2>${node ? "Junction" : road ? "Road segment" : "Road network"}</h2><p>${node ? "Shared graph vertex" : road ? "Connected curve geometry" : "Procedural collection"}</p></div><span class="tag">${node ? "EDIT" : "LIVE"}</span></div><div class="inspector-subtabs"><button class="${section === "geometry" ? "active" : ""}" data-section="geometry">Geometry</button><button class="${section === "details" ? "active" : ""}" data-section="details">Details</button><button class="${section === "streets" ? "active" : ""}" data-section="streets">Pavement</button><button class="${section === "traffic" ? "active" : ""}" data-section="traffic">Traffic</button></div><div id="properties"></div>`;
  const props = $("#properties");
  if (section === "streets") {
    const settings = streetSettings(model),
      summary = scene?.streetscape;
    props.innerHTML = `<div class="section-heading"><span>PAVEMENT & CROSSINGS</span>${icon("footprints")}</div>${toggle("street-crossings", "Zebra crosswalks", model.layers.crossings, "Shared alignment with curb ramps")}${toggle("street-ramps", "Pedestrian curb ramps", model.layers.ramps, "Flush entry · separate from vehicle aprons")}<label class="property">Ramp type <select id="pedestrian-mode"><option value="auto" ${settings.pedestrianMode === "auto" ? "selected" : ""}>Auto / fit pavement</option><option value="perpendicular" ${settings.pedestrianMode === "perpendicular" ? "selected" : ""}>Perpendicular</option><option value="parallel" ${settings.pedestrianMode === "parallel" ? "selected" : ""}>Parallel / dropped</option></select></label>${toggle("street-tactile", "Tactile warning paving", settings.tactile, "Inset tiles · 5 mm truncated domes")}${range("street-width", "Sidewalk width", model.sidewalk, 0, 5, 0.1, "m")}${range("street-crossing-width", "Crosswalk width", settings.crossingWidth, 2.4, 4, 0.2, "m")}${range("street-ramp-run", "Ramp run", settings.rampRun, 1.8, 2.4, 0.1, "m")}<button class="wide-button" id="edit-paving">${icon("swatch-book")} Paving design & material</button><div class="section-heading top-border"><span>ROADSIDE DRAINAGE</span>${icon("list-filter")}</div>${toggle("street-drainage", "Channels & grated inlets", model.layers.drainage, "Recessed gutter and open grate slots")}${range("street-drain-spacing", "Inlet spacing", settings.drainSpacing, 15, 60, 5, "m")}<div class="section-heading top-border"><span>UTILITY ACCESS</span>${icon("circle-dot")}</div>${toggle("street-manholes", "Recessed manhole covers", model.layers.manholes, "Road cutout · cast-iron frame")}${range("street-manhole-diameter", "Frame diameter", Math.round(settings.manholeDiameter * 1000), 500, 1000, 50, "mm")}${range("street-manhole-spacing", "Cover spacing", settings.manholeSpacing, 30, 120, 10, "m")}<div class="section-heading top-border"><span>PLACEMENT CHECKS</span>${icon("shield-check")}</div><div class="summary-cards"><div><strong>${summary?.ramps || 0}</strong><span>Pedestrian ramps</span></div><div><strong>${summary?.grates || 0}</strong><span>Inlets</span></div><div><strong>${summary?.manholes || 0}</strong><span>Covers</span></div></div>${(summary?.warnings || []).map((w) => `<div class="info-note design-warning">${icon("triangle-alert")}${w}</div>`).join("")}<div class="info-note">${icon("info")}150 mm rise. Auto uses parallel/dropped ramps on constrained pavements. Perpendicular ramps require a 1.22 m landing; flares use at least 1.5 m. Local accessibility review remains required. Drainage geometry is not a hydraulic or underground pipe simulation.</div>`;
    props.insertAdjacentHTML(
      road ? "afterbegin" : "beforeend",
      vehicleControls(road),
    );
    bindVehicle(road);
    $("#pedestrian-mode").onchange = (e) =>
      mutate(() => (model.streets.pedestrianMode = e.target.value));
    for (const key of ["crossings", "ramps", "drainage", "manholes"])
      $("#street-" + key).onchange = (e) =>
        mutate(() => (model.layers[key] = e.target.checked));
    $("#street-tactile").onchange = (e) =>
      mutate(() => (model.streets.tactile = e.target.checked));
    bindRange("street-width", (v) => (model.sidewalk = v));
    for (const [id, key, factor] of [
      ["street-crossing-width", "crossingWidth", 1],
      ["street-ramp-run", "rampRun", 1],
      ["street-drain-spacing", "drainSpacing", 1],
      ["street-manhole-diameter", "manholeDiameter", 0.001],
      ["street-manhole-spacing", "manholeSpacing", 1],
    ])
      bindRange(id, (v) => (model.streets[key] = v * factor));
    $("#edit-paving").onclick = () => setTab("materials");
  } else if (section === "traffic") {
    props.innerHTML = `<div class="section-heading"><span>TRAFFIC PREVIEW</span><span>MAX 25</span></div>${toggle("traffic-enabled", "Enable vehicles", model.layers.traffic)}${range("vehicle-count", "Vehicle count", model.traffic, 0, 25, 1, "vehicles")}${range("speed", "Target speed", model.speed, 5, 60, 5, "km/h")}<button class="wide-button" id="pause-traffic">${icon(paused ? "play" : "pause")} ${paused ? "Resume" : "Pause"} simulation</button><div class="info-note">${icon("info")}Continuous lane paths, curved junction connections, headway and speed-hump response. Vehicles stop at dead ends; not a certified traffic solver.</div>`;
    bindRange("vehicle-count", (v) => (model.traffic = v));
    bindRange("speed", (v) => (model.speed = v));
    $("#traffic-enabled").onchange = (e) =>
      mutate(() => (model.layers.traffic = e.target.checked));
    $("#pause-traffic").onclick = () => {
      paused = !paused;
      scene.setPaused(paused);
      inspector("traffic");
    };
  } else if (section === "details") {
    props.innerHTML = `<div class="section-heading"><span>STREET ASSEMBLY</span>${icon("chevron-up")}</div>${toggle("detail-curbs", "Raised curbs", model.layers.curbs, "150 mm above asphalt")}${toggle("detail-sidewalks", "Paved sidewalks", model.layers.sidewalks, "Continuous offset boundary")}${toggle("detail-markings", "Road markings", model.layers.markings, "Metric dashed lines & crossings")}${toggle("detail-lights", "Street lights", model.layers.lights, "7.2 m poles · 29 m spacing")}${toggle("detail-bollards", "Steel bollards", model.layers.bollards, "900 mm cylindrical posts")}${toggle("detail-landscape", "Block planting", model.layers.landscape, "Open blocks · no buildings")}<div class="info-note">${icon("info")}Details regenerate with the network. Junction setbacks keep markings out of the merged center.</div>`;
    props.insertAdjacentHTML("beforeend", humpControls(road));
    if (road) {
      $("#hump-enabled").onchange = (e) => {
        const enabled = e.target.checked;
        if (
          enabled &&
          !humpSpec(
            { ...road, speedHump: DEFAULT_HUMP },
            { ...model, layers: { ...model.layers, calming: true } },
          )
        ) {
          e.target.checked = false;
          toast("Road too short: use a longer segment.");
          return;
        }
        mutate(() => {
          if (enabled) {
            road.speedHump = { ...DEFAULT_HUMP };
            model.layers.calming = true;
          } else delete road.speedHump;
        });
      };
      bindRange("hump-height", (v) => (road.speedHump.height = v / 1000));
      bindRange("hump-length", (v) => (road.speedHump.length = v));
      bindRange("hump-position", (v) => (road.speedHump.position = v / 100));
    }
    [
      "curbs",
      "sidewalks",
      "markings",
      "lights",
      "bollards",
      "landscape",
    ].forEach(
      (k) =>
        ($("#detail-" + k).onchange = (e) =>
          mutate(() => (model.layers[k] = e.target.checked))),
    );
  } else {
    props.innerHTML = `<div class="section-heading"><span>${node ? "JUNCTION TRANSFORM" : "ROAD PROFILE"}</span>${icon("chevron-up")}</div>${node ? `<div class="xy-fields"><label>X <input id="node-x" type="number" step="1" value="${node.x.toFixed(1)}"><small>m</small></label><label>Z <input id="node-z" type="number" step="1" value="${node.z.toFixed(1)}"><small>m</small></label></div><button id="move-selected" class="wide-button">${icon("move")} Move with viewport gizmo</button>` : `<label class="property">Road class <select id="road-class"><option value="9">Local street</option><option value="12">Urban collector</option><option value="14">Four-lane arterial</option></select></label>${range("road-width", road ? "Carriageway width" : "Default / all road widths", road?.width || 10, 6, 20, 0.5, "m")}`}${range("sidewalk-width", "Sidewalk width", model.sidewalk, 0, 5, 0.1, "m")}<div class="section-heading top-border"><span>INTERSECTION SOLVER</span><span class="mini-dot"></span></div><label class="property">Connection <span class="value-pill">${icon("git-merge")} Surface union</span></label>${range("corner-radius", "Corner closing radius", model.radius, 0, 12, 0.5, "m")}<div class="quality-note">${icon("check-circle-2")}<div><strong>One continuous road surface</strong><p>Boolean-unioned junctions. No overlapping road decks.</p></div></div>${road ? `${range("curve-bend", "Curve control offset", road.control ? Math.round(road.control[1] - (model.nodes.find((n) => n.id === road.a).z + model.nodes.find((n) => n.id === road.b).z) / 2) : 0, -40, 40, 1, "m")}<button id="delete-road" class="wide-button danger">${icon("trash-2")} Delete segment</button>` : ""}<div class="section-heading top-border"><span>NETWORK SUMMARY</span>${icon("activity")}</div><div class="summary-cards"><div><strong>${model.roads.length}</strong><span>Road segments</span></div><div><strong>${junctions()}</strong><span>Junctions</span></div><div><strong>${((scene?.data?.length || 0) / 1000).toFixed(2)}<small> km</small></strong><span>Total length</span></div></div><div class="info-note">${icon("info")}Quad curb strips; triangulated merged surface. Local-road prototype, not a certified civil design tool.</div>`;
    if (node) {
      ["x", "z"].forEach(
        (k) =>
          ($("#node-" + k).onchange = (e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && Math.abs(v) < 10000)
              mutate(() => {
                moveJunction(
                  model,
                  node.id,
                  k === "x" ? v : node.x,
                  k === "z" ? v : node.z,
                );
                reconcileIntersections(model);
              });
            else toast("Enter a coordinate between −10,000 and 10,000 m");
          }),
      );
      $("#move-selected").onclick = () => setTool("move");
    } else {
      $("#road-class").value =
        road?.width === 14 ? "14" : road?.width === 12 ? "12" : "9";
      $("#road-class").onchange = (e) =>
        mutate(() => {
          const width = Number(e.target.value);
          if (road) road.width = width;
          else model.roads.forEach((r) => (r.width = width));
        });
      bindRange("road-width", (v) => {
        if (road) road.width = v;
        else model.roads.forEach((r) => (r.width = v));
      });
    }
    bindRange("sidewalk-width", (v) => (model.sidewalk = v));
    bindRange("corner-radius", (v) => (model.radius = v));
    if (road) {
      props.insertAdjacentHTML(
        "beforeend",
        `<label class="property">Road surface <select id="road-finish"><option value="asphalt">Asphalt</option><option value="concrete">Concrete access</option></select></label>`,
      );
      $("#road-finish").value = road.surface || "asphalt";
      $("#road-finish").onchange = (e) =>
        mutate(() => (road.surface = e.target.value));
      bindRange("curve-bend", (v) => {
        const a = model.nodes.find((n) => n.id === road.a),
          b = model.nodes.find((n) => n.id === road.b);
        delete road.points;
        road.control = [(a.x + b.x) / 2, (a.z + b.z) / 2 + v];
        reconcileIntersections(model);
      });
      $("#delete-road").onclick = () =>
        mutate(() => {
          model.roads = model.roads.filter((r) => r.id !== road.id);
          model.nodes = model.nodes.filter((n) =>
            model.roads.some((r) => r.a === n.id || r.b === n.id),
          );
          selected = null;
        });
    }
  }
  if (tab === "network" && section === "geometry") {
    const node = model.nodes.find((n) => n.id === selected),
      r = model.roads.find((r) => r.id === selected);
    if (node) {
      props.insertAdjacentHTML(
        "afterbegin",
        `<div class="section-heading"><span>ELEVATION · SHARED JUNCTION</span></div>${range("node-y", "Junction height", heightOf(node), 0, 40, 0.25, "m")}<div class="info-note">All connected road ends move together. Shift-drag this junction vertically in Move mode.</div>`,
      );
      bindRange("node-y", (v) => {
        node.y = v;
        reconcileIntersections(model);
      });
    }
    if (r) {
      const [a, b] = roadLevels(r, model),
        source = scene.data.sampled.find((x) => x.id === r.id),
        L = source.samples.lengthMeters,
        grade =
          (Math.abs(b - a) * 1.5) /
          Math.max(
            0.01,
            L - landingRun(source, model) - landingRun(source, model, 1),
          );
      props.insertAdjacentHTML(
        "afterbegin",
        `<div class="section-heading"><span>ROAD / BRIDGE · ONE GRAPH</span></div>${range("road-elevation", "Raise road / shared ends", (a + b) / 2, 0, 40, 0.25, "m")}${range("road-start-y", "Start elevation", a, 0, 40, 0.25, "m")}${range("road-end-y", "End elevation", b, 0, 40, 0.25, "m")}<div class="info-note">${isElevated(r, model) ? "Bridge structure generated automatically." : "Ground road — raise either end to generate a bridge."} Shared endpoints remain connected; adjoining roads become approaches. ${(grade * 100).toFixed(1)}% peak centreline grade.${grade > 0.083 ? " Approach is steeper than the 8.3% preview target." : ""} Separate overpasses do not connect.</div>${(
          scene.data.roadChecks || []
        )
          .filter((c) => c.roads.includes(r.id) && c.clearance < 5)
          .map(
            (c) =>
              `<div class="info-note design-warning">${icon("triangle-alert")}Road proximity: ${c.clearance.toFixed(2)} m sampled deck clearance (5 m preview target). Review crossing geometry and vehicle envelope.</div>`,
          )
          .join(
            "",
          )}<div class="info-note">400 mm concept slab; guardrails and candidate supports. Not structurally designed. Elevated pedestrian sidewalks and detailed bridge drainage are not yet generated.</div><button id="focus-road" class="wide-button">${icon("scan")} Frame road / bridge</button><div class="section-heading"><span>SPLINE CONTROL · METRES</span></div><div class="xy-fields"><label>X <input id="spline-x" type="number" step="1" value="${r.control?.[0] ?? (model.nodes.find((n) => n.id === r.a).x + model.nodes.find((n) => n.id === r.b).x) / 2}"></label><label>Z <input id="spline-z" type="number" step="1" value="${r.control?.[1] ?? (model.nodes.find((n) => n.id === r.a).z + model.nodes.find((n) => n.id === r.b).z) / 2}"></label></div><div class="info-note">Edit the quadratic control point, or drag its handle in Move mode. Editing a sampled split segment replaces it with a quadratic curve. Same-level crossings are rebuilt on release.</div>`,
      );
      $("#focus-road").onclick = () => {
        topView = false;
        scene.focus(r.id);
        $("#perspective").innerHTML =
          icon("box") + "Perspective" + icon("chevron-down");
        iconize();
      };
      bindRange("road-elevation", (v) => {
        liftRoad(model, r.id, v);
        reconcileIntersections(model);
      });
      for (const [id, end] of [
        ["road-start-y", "a"],
        ["road-end-y", "b"],
      ])
        bindRange(id, (v) => {
          model.nodes.find((n) => n.id === r[end]).y = v;
          reconcileIntersections(model);
        });
      for (const axis of ["x", "z"])
        $("#spline-" + axis).onchange = () => {
          const x = Number($("#spline-x").value),
            z = Number($("#spline-z").value);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(z) ||
            Math.abs(x) > 9999 ||
            Math.abs(z) > 9999
          )
            return;
          mutate(() => {
            delete r.points;
            r.control = [x, z];
            reconcileIntersections(model);
          });
        };
    }
  }
  propertyCards(props);
  document
    .querySelectorAll("[data-section]")
    .forEach((b) => (b.onclick = () => inspector(b.dataset.section)));
  iconize();
}
function bindRange(id, fn) {
  const input = $("#" + id);
  if (!input) return;
  input.oninput = () => {
    const out = $("#" + id + "-value");
    out.firstChild.textContent = input.value;
    input.style.setProperty(
      "--progress",
      ((input.value - input.min) / (input.max - input.min)) * 100 + "%",
    );
  };
  input.onchange = () => mutate(() => fn(Number(input.value)));
}
function junctions() {
  return model.nodes.filter(
    (n) => model.roads.filter((r) => r.a === n.id || r.b === n.id).length > 2,
  ).length;
}
function snapshot() {
  history.push(JSON.stringify(model));
  if (history.length > 40) history.shift();
  future = [];
}
function rebuild() {
  const data = scene.rebuild(model);
  $("#road-count").textContent = `${model.roads.length} segments`;
  $("#junction-count").textContent = `${junctions()} junctions`;
  $("#mesh-stat").textContent =
    `${((data.mesh.indices.length + (data.structures || []).reduce((s, p) => s + p.top.indices.length, 0)) / 3).toLocaleString()} surface triangles`;
  names();
  layers();
  scene.selection(selected);
  $("#status").textContent = "Network up to date";
}
function mutate(fn) {
  snapshot();
  fn();
  dirty = true;
  rebuild();
  inspector();
  $(".save-dot").classList.add("unsaved");
}
function undo() {
  if (!history.length) return toast("No changes to undo");
  future.push(JSON.stringify(model));
  model = JSON.parse(history.pop());
  if (
    !model.roads.some((r) => r.id === selected) &&
    !model.nodes.some((n) => n.id === selected) &&
    !(model.connections || []).some((c) => c.id === selected)
  )
    selected = null;
  dirty = true;
  rebuild();
  inspector();
  toast("Change undone");
}
function redo() {
  if (!future.length) return toast("No changes to redo");
  history.push(JSON.stringify(model));
  model = JSON.parse(future.pop());
  if (
    !model.roads.some((r) => r.id === selected) &&
    !model.nodes.some((n) => n.id === selected) &&
    !(model.connections || []).some((c) => c.id === selected)
  )
    selected = null;
  dirty = true;
  rebuild();
  inspector();
  toast("Change restored");
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function setTool(v) {
  tool = v;
  scene?.setMode(v);
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === v));
  $("#tool-hint").classList.toggle("hidden", v === "select");
  $("#tool-hint").innerHTML =
    v === "draw"
      ? `${icon("spline")} ${drawKind === "asphalt" ? "Road" : drawKind === "roadbridge" ? `Road bridge · Y ${drawElevation} m` : drawKind === "bridge" ? "Park bridge · ends in parks" : drawKind === "walkway" ? "Walkway · snaps to footway" : "Concrete · snaps to road"}: start → control → end <span>ESC to cancel</span>`
      : `${icon("move")} Drag a junction or curve handle · Shift-drag junction to change height <span>V to select</span>`;
  if (v !== "draw") {
    drawPoints = [];
    scene?.draft([]);
  }
  iconize();
}
function setTab(value) {
  tab = value;
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  layers();
  inspector("geometry");
}
function thumb(kind) {
  const defs = `<defs><pattern id="grid-${kind}" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M 16 0 L 0 0 0 16" fill="none" stroke="#ffffff" stroke-opacity=".04"/></pattern></defs>`;
  let paths = ["parks", "bridges"].includes(kind)
    ? ["M85 -10 V115", "M85 78 H175", "M-5 35 H175"]
    : kind === "district"
      ? [
          "M-10 36 H180",
          "M-10 78 H180",
          "M46 -10 V115",
          "M112 -10 Q102 50 131 110",
        ]
      : kind === "junction"
        ? ["M-10 52 H180", "M85 -10 V115"]
        : [
            "M15 108 Q70 73 85 49",
            "M85 49 Q95 22 138 -10",
            "M85 49 Q58 27 45 -10",
          ];
  return `<svg viewBox="0 0 170 105">${defs}<rect width="170" height="105" fill="#303030"/><rect width="170" height="105" fill="url(#grid-${kind})"/>${paths.map((d) => `<path d="${d}" fill="none" stroke="#747474" stroke-width="18"/>`).join("")}${paths.map((d) => `<path d="${d}" fill="none" stroke="#252525" stroke-width="13"/>`).join("")}${paths.map((d) => `<path d="${d}" fill="none" stroke="#aaa9a7" stroke-width=".7" stroke-dasharray="4 5"/>`).join("")}<circle cx="85" cy="52" r="3" fill="#cccccc"/></svg>`;
}
const pavingThumbs = new Map();
function pavingThumbnail(pattern) {
  if (!pavingThumbs.has(pattern))
    pavingThumbs.set(pattern, pavingCanvases(pattern).color.toDataURL());
  return `<img class="paving-thumbnail" src="${pavingThumbs.get(pattern)}" alt="">`;
}
function assets() {
  $("#asset-cards").classList.toggle("paving-library", assetTab === "Surfaces");
  const entries =
    assetTab === "Networks"
      ? [
          ["bridges", "Unified road & bridges", "ONE GRAPH · 3D JUNCTIONS"],
          ["district", "Urban district", "CONNECTED NETWORK"],
          ["junction", "Four-way junction", "4 APPROACHES"],
          ["fork", "Y-junction", "3 APPROACHES"],
          ["parks", "Park connections", "WALKWAYS · ACCESS · BRIDGE"],
        ]
      : assetTab === "Details"
        ? [
            ["speed-hump", "Raised speed hump", "75 MM · CONFIGURABLE"],
            ["vehicle-entry", "Vehicle crossover", "DROPPED KERB · FOOTWAY"],
            ["lights", "Street lighting", "7.2 M · STEEL"],
            ["bollards", "Steel bollards", "0.9 M · CYLINDRICAL"],
            ["landscape", "Block planting", "PROCEDURAL"],
          ]
        : [
            ["asphalt", "Fine asphalt", "PBR · AGGREGATE"],
            ...PAVING_PATTERNS.map((pattern) => [
              "paving:" + pattern,
              pattern,
              "PAVING · RELIEF MATERIAL",
            ]),
          ];
  $("#asset-cards").innerHTML = entries
    .map(
      ([id, name, sub]) =>
        `<button class="asset-card" data-preset="${id}"><div class="asset-preview">${assetTab === "Networks" ? thumb(id) : id.startsWith("paving:") ? pavingThumbnail(id.slice(7)) : `<div class="detail-preview ${id}">${icon(id === "speed-hump" ? "waves" : id === "lights" ? "lamp-floor" : id === "bollards" ? "columns-3" : id === "landscape" ? "trees" : "grid-2x2")}</div>`}<span class="asset-add">${icon("plus")}</span></div><strong>${name}</strong><small>${sub}</small></button>`,
    )
    .join("");
  $("#asset-eyebrow").textContent =
    assetTab === "Networks"
      ? "START WITH A NETWORK"
      : assetTab === "Details"
        ? "FINISH THE STREET"
        : "BUILD YOUR SURFACE";
  $("#asset-heading").innerHTML =
    assetTab === "Networks"
      ? "A foundation for<br>every journey."
      : assetTab === "Details"
        ? "The details<br>make the place."
        : "Materials with<br>a sense of place.";
  $("#asset-description").textContent =
    assetTab === "Networks"
      ? "Choose a layout. Make it your own."
      : "Apply to the current road network.";
  iconize();
}
function modal(title, content) {
  const d = $("#dialog");
  d.innerHTML = `<div class="dialog-heading"><h2>${title}</h2><button class="icon-button" id="close-dialog" aria-label="Close">${icon("x")}</button></div>${content}`;
  $("#close-dialog").onclick = () => d.close();
  iconize();
  d.showModal();
}
function replaceNetwork(kind) {
  modal(
    "Create a new network",
    `<p>This replaces the current network. You can undo the change, or save your project first.</p><div class="dialog-actions"><button class="wide-button" id="cancel-new">Cancel</button><button class="primary-button" id="confirm-new">Create network</button></div>`,
  );
  $("#cancel-new").onclick = () => $("#dialog").close();
  $("#confirm-new").onclick = () => {
    mutate(() => {
      model = preset(kind);
      if (kind === "empty") {
        model.name = "Untitled network";
        model.roads = [];
        model.nodes = [];
      }
      selected = null;
    });
    setView(false);
    setTab("network");
    document
      .querySelectorAll("[data-workspace]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.workspace === "layout"),
      );
    $("#dialog").close();
    toast("Network created");
    if (kind === "empty") setTool("draw");
  };
}
function download(content, name, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#export").onclick = () => {
  modal(
    "Export network",
    `<p>Keep the editable graph, or export the merged road surface in real-world meters.</p><button class="export-option" id="export-project">${icon("file-json")}<span><strong>Slate project</strong><small>JSON · editable curves, graph & settings</small></span>${icon("arrow-down-to-line")}</button><button class="export-option" id="export-mesh">${icon("box")}<span><strong>Road surface mesh</strong><small>OBJ · road faces + network bridge slabs</small></span>${icon("arrow-down-to-line")}</button><div class="info-note">${icon("info")}Ground road cutouts and network bridge slab tops/shells are exported. Bridge rails/supports, park connections, paving/ramp detail, curbs and props are not included.</div>`,
  );
  $("#export-project").onclick = () => {
    download(JSON.stringify(model, null, 2), "network.slate");
    toast("Editable project exported");
  };
  $("#export-mesh").onclick = () => {
    download(scene.exportOBJ(), "road-surface.obj", "text/plain");
    toast("Merged road surface exported");
  };
};
$("#file-menu").onclick = () => {
  modal(
    "Project",
    `<button class="export-option" id="file-new">${icon("plus")} New empty network</button><button class="export-option" id="file-open">${icon("folder-open")} Open Slate project</button><button class="export-option" id="file-download">${icon("download")} Download editable project</button>`,
  );
  $("#file-new").onclick = () => {
    $("#dialog").close();
    replaceNetwork("empty");
  };
  $("#file-open").onclick = () => {
    $("#dialog").close();
    $("#import-input").click();
  };
  $("#file-download").onclick = () =>
    download(JSON.stringify(model, null, 2), "network.slate");
};
$("#import-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5e6) throw Error("Project exceeds 5 MB limit");
    const next = validateModel(JSON.parse(await file.text()));
    mutate(() => {
      model = next;
      selected = null;
    });
    toast("Project loaded");
  } catch (err) {
    toast("Import failed: " + err.message);
  }
  e.target.value = "";
};
$("#save").onclick = () => {
  try {
    localStorage.setItem("slate-project", JSON.stringify(model));
    dirty = false;
    $(".save-dot").classList.remove("unsaved");
    toast("Project saved in this browser");
  } catch {
    toast("Browser storage is full. Use Export to save a project file.");
  }
};
$("#help").onclick = () =>
  modal(
    "A road workspace, not a node editor",
    `<p>Orbit with left drag, pan with middle drag, and scroll to zoom. Hold right mouse to look and fly with WASD. Q/E move down/up; Shift is 4× faster; the wheel changes fly speed. Release RMB or press Escape to stop. Flight has no terrain collision. Click a road or junction to inspect it. Choose Network bridge road and a Y height to draw elevated roads. Use the elevation sliders to raise existing roads; Shift-drag a junction in Move mode to change its height. Same-level crossings join; different-height roads remain overpasses.</p><div class="shortcut-list"><span>Select<kbd>V</kbd></span><span>Move a shared junction<kbd>G</kbd></span><span>Draw: start → control → end<kbd>B</kbd></span><span>Frame the network<kbd>F</kbd></span><span>Undo / redo<kbd>Ctrl Z / Shift Z</kbd></span></div><h3>What this build supports</h3><p>One road/bridge graph with editable spline controls and endpoint elevations, same-height merged junctions, grade-separated crossings, continuous ground sidewalks and curbs, procedural surface materials, markings, street lights, bollards, raised speed humps, planting, and a maximum of 25 graph-following vehicles.</p><h3>Production scope still to build</h3><p>Engineering-rated bridges/interchanges, tunnels, rail/subway systems, construction staging, potholes and certified traffic rules are not implemented. Network bridge slabs, rails, candidate supports and sloping approaches are previews, not load-rated designs. Curb ramps and tactile paving are implemented, but require local accessibility review. Acute junctions still need design validation. This is a functional foundation, not an AAA-ready civil engineering suite.</p>`,
  );
$("#fly-status").onclick = () => $("#help").click();
$("#settings").onclick = () =>
  modal(
    "Workspace",
    `<p>Geometry is in meters. WebGPU is preferred; unsupported browsers use a clearly labeled WebGL2 fallback.</p><div class="property">Renderer <strong>${scene?.backend || "Starting"}</strong></div><div class="property">Traffic limit <strong>25 vehicles</strong></div><div class="property">Surface topology <strong>Indexed triangles</strong></div><p>All generation runs locally. Projects are only saved when you press Save or download an export.</p>`,
  );
$("#undo").onclick = $("#undo-tool").onclick = undo;
$("#redo-tool").onclick = redo;
$("#new-network").onclick = () => replaceNetwork("empty");
$("#draw-kind").onchange = (e) => {
  drawKind = e.target.value;
  drawElevation = drawKind === "roadbridge" ? 6 : 0;
  $("#draw-elevation").value = drawElevation;
  scene?.setDrawElevation(drawElevation);
  drawPoints = [];
  scene?.draft([]);
  if (tool === "draw") setTool("draw");
};
$("#draw-elevation").onchange = (e) => {
  drawElevation = Math.max(0, Math.min(40, Number(e.target.value) || 0));
  e.target.value = drawElevation;
  scene?.setDrawElevation(drawElevation);
  drawPoints = [];
  scene?.draft([]);
};
$("#draw-connection").onclick = () => setTool("draw");
$("#draw-road").onclick = $("#add-layer").onclick = () => setTool("draw");
let topView = false,
  gridOn = false,
  wireOn = false,
  night = false;
function setView(top) {
  topView = top;
  scene.setView(top ? "top" : "perspective");
  $("#perspective").innerHTML =
    icon(top ? "scan" : "box") +
    (top ? "Top view" : "Perspective") +
    icon("chevron-down");
  iconize();
}
$("#perspective").onclick = $("#view-menu").onclick = () => setView(!topView);
$("#street-view").onclick = () => {
  topView = false;
  scene.streetView();
  $("#perspective").innerHTML =
    icon("person-standing") + "Street view" + icon("chevron-down");
  iconize();
};
$("#frame").onclick = () => setView(false);
$("#grid").onclick = () => {
  gridOn = !gridOn;
  scene.setGrid(gridOn);
  $("#grid").classList.toggle("active", gridOn);
};
$("#wire").onclick = () => {
  wireOn = !wireOn;
  scene.setWire(wireOn);
  $("#wire").classList.toggle("active", wireOn);
  toast(wireOn ? "Indexed triangle topology" : "Lit surface");
};
$("#shading").onclick = () => {
  night = !night;
  scene.setLight(night ? 1 : 3.1);
  $("#shading").innerHTML = (night ? "Overcast" : "Lit") + icon("chevron-down");
  iconize();
};
$("#collapse-assets").onclick = () =>
  $(".asset-browser").classList.toggle("collapsed");
$("#layer-list").onclick = (e) => {
  const link = e.target.closest("[data-connection]");
  if (link) {
    selected = decodeURIComponent(link.dataset.connection);
    scene.selection(selected);
    inspector();
    layers();
    return;
  }
  const b = e.target.closest("[data-visibility]");
  if (b) {
    const k = b.dataset.visibility;
    mutate(() => (model.layers[k] = !model.layers[k]));
    return;
  }
  const layer = e.target.closest("[data-layer]");
  if (layer) {
    if (layer.dataset.layer !== "driveways") {
      selected = null;
      scene.selection(null);
    }
    inspector(
      [
        "crossings",
        "ramps",
        "driveways",
        "drainage",
        "manholes",
        "sidewalks",
        "curbs",
      ].includes(layer.dataset.layer)
        ? "streets"
        : layer.dataset.layer === "traffic"
          ? "traffic"
          : layer.dataset.layer === "roads"
            ? "geometry"
            : "details",
    );
    document
      .querySelectorAll(".layer-row")
      .forEach((el) => el.classList.toggle("selected", el === layer));
  }
  const material = e.target.closest("[data-material]");
  if (material) {
    document
      .querySelectorAll(".layer-row")
      .forEach((el) => el.classList.toggle("selected", el === material));
    inspector();
  }
};
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tool]");
  if (t) setTool(t.dataset.tool);
  const tabButton = e.target.closest("[data-tab]");
  if (tabButton) setTab(tabButton.dataset.tab);
  const a = e.target.closest("[data-asset]");
  if (a) {
    assetTab = a.dataset.asset;
    document
      .querySelectorAll("[data-asset]")
      .forEach((b) => b.classList.toggle("active", b === a));
    assets();
  }
  const p = e.target.closest("[data-preset]");
  if (p) {
    const id = p.dataset.preset;
    if (assetTab === "Networks") replaceNetwork(id);
    else if (assetTab === "Details") {
      if (id === "vehicle-entry") {
        const road = model.roads.find((r) => r.id === selected);
        if (!road) {
          toast("Select a road first to place a vehicle crossover.");
          return;
        }
        mutate(() => {
          road.driveway = { ...DEFAULT_DRIVEWAY };
          model.layers.driveways = true;
        });
        setTab("network");
        inspector("streets");
        return;
      }
      if (id === "speed-hump") {
        addHump();
        return;
      }
      mutate(() => (model.layers[id] = !model.layers[id]));
      toast(
        `${id === "lights" ? "Street lighting" : id === "bollards" ? "Bollards" : "Planting"} ${model.layers[id] ? "enabled" : "hidden"}`,
      );
    } else {
      mutate(() => {
        if (id === "asphalt") model.materials.asphalt = "#4c5357";
        else
          model.materials.paving = id.startsWith("paving:")
            ? id.slice(7)
            : "Running bond";
      });
      setTab("materials");
      toast("Surface applied");
    }
  }
  const w = e.target.closest("[data-workspace]");
  if (w) {
    document
      .querySelectorAll("[data-workspace]")
      .forEach((b) => b.classList.toggle("active", b === w));
    setTab(w.dataset.workspace === "materials" ? "materials" : "network");
    if (w.dataset.workspace === "simulate") inspector("traffic");
  }
});
document.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
    $("#dialog").open
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    $("#save").click();
    return;
  }
  if (e.key === "Escape") setTool("select");
  if (e.key.toLowerCase() === "v") setTool("select");
  if (e.key.toLowerCase() === "g") setTool("move");
  if (e.key.toLowerCase() === "b") setTool("draw");
  if (e.key.toLowerCase() === "f") setView(false);
});
layers();
assets();
inspector();
iconize();
window.addEventListener("slate-device-lost", () => {
  $("#backend").textContent = "GPU DISCONNECTED";
  modal(
    "Graphics device disconnected",
    `<p>The browser could not keep its WebGPU device active. Your network is still available. Reload with the WebGL2 renderer to continue editing.</p><button id="recover-renderer" class="primary-button">Reload in compatibility mode</button>`,
  );
  $("#recover-renderer").onclick = () => {
    sessionStorage.setItem("slate-recovery", JSON.stringify(model));
    dirty = false;
    const url = new URL(location.href);
    url.searchParams.set("renderer", "webgl");
    location.href = url.href;
  };
});
let dragSnapshot = false,
  lastDrag = 0;
try {
  scene = await createScene(
    $("#viewport"),
    (id) => {
      selected = id;
      scene.selection(id);
      setTab("network");
    },
    (id, p, done) => {
      if (!dragSnapshot) {
        snapshot();
        dragSnapshot = true;
      }
      const n = model.nodes.find((n) => n.id === id);
      const r = model.roads.find((r) => r.id === id);
      if (r) {
        delete r.points;
        r.control = [p[0], p[1]];
      } else if (p[2] !== undefined) n.y = Math.max(0, Math.min(40, p[2]));
      else
        moveJunction(
          model,
          id,
          Math.round(p[0] * 2) / 2,
          Math.round(p[1] * 2) / 2,
        );
      if (done) reconcileIntersections(model);
      if (done || performance.now() - lastDrag > 150) {
        rebuild();
        lastDrag = performance.now();
      }
      if (done) {
        dragSnapshot = false;
        dirty = true;
        inspector();
      }
    },
    (p) => {
      if (
        ["walkway", "bridge", "concrete"].includes(drawKind) &&
        drawElevation === 0 &&
        drawPoints.length !== 1
      )
        p = snapConnection(p, model, drawKind);
      if (!["walkway", "bridge"].includes(drawKind) && drawPoints.length !== 1)
        p = snapRoadDrawingPoint(model, p, drawElevation);
      drawPoints.push(p);
      scene.draft(drawPoints);
      if (drawPoints.length === 3) {
        const [a, c, b] = drawPoints,
          points = Array.from({ length: 65 }, (_, i) => {
            const t = i / 64,
              s = 1 - t;
            return [
              s * s * a[0] + 2 * s * t * c[0] + t * t * b[0],
              s * s * a[1] + 2 * s * t * c[1] + t * t * b[1],
            ];
          });
        if (drawKind === "walkway" || drawKind === "bridge")
          mutate(() => {
            const id = crypto.randomUUID();
            model.connections ??= [];
            model.connections.push({
              id,
              kind: drawKind,
              width: drawKind === "bridge" ? 4.5 : 2.5,
              height: 5.5,
              points,
            });
            model.layers[drawKind === "bridge" ? "bridges" : "walkways"] = true;
            selected = id;
          });
        else
          mutate(() => {
            const created = addCurve(
              model,
              points,
              drawKind === "concrete" ? 5 : 10,
              drawKind === "concrete"
                ? {
                    surface: "concrete",
                    name: "Concrete access",
                    elevation: drawElevation,
                    levels: [a[2] ?? drawElevation, b[2] ?? drawElevation],
                    control: c,
                  }
                : {
                    elevation: drawElevation,
                    levels: [a[2] ?? drawElevation, b[2] ?? drawElevation],
                    name: drawElevation > 0 ? "Bridge road" : "Drawn road",
                    control: c,
                  },
            );
            selected = created.at(-1)?.id;
          });
        drawPoints = [];
        scene.draft([]);
        toast(
          drawKind === "asphalt"
            ? "Road added · same-level crossings connected"
            : drawKind === "concrete"
              ? "Concrete access added · road graph connected"
              : drawKind === "roadbridge"
                ? "Bridge added to the road graph · select to edit elevation"
                : "Park connection added · inspect placement warnings",
        );
        if (drawKind !== "asphalt") setTool("select");
      } else
        toast(
          drawPoints.length === 1
            ? "Start set. Click the curve control point."
            : "Control set. Click the end of your road.",
        );
    },
  );
  rebuild();
  if (model.roads.some((r) => isElevated(r, model)))
    scene.setView("perspective");
  inspector();
  $("#backend").textContent = scene.backend.toUpperCase();
  $("#loading").remove();
  setInterval(() => ($("#fps").textContent = `${scene.fps} FPS`), 1000);
} catch (err) {
  $("#loading").innerHTML =
    `Unable to initialize the 3D viewport. Enable graphics acceleration and reload.`;
  console.error(err);
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
// Exposed read-only inspection hook for automated geometry/interaction checks.
window.__slate = {
  get model() {
    return structuredClone(model);
  },
  get backend() {
    return scene?.backend;
  },
  get connections() {
    return scene?.connections;
  },
  get navigation() {
    return scene?.navigation;
  },
  get streetscape() {
    return scene?.streetscape;
  },
  get traffic() {
    return scene?.trafficState;
  },
  get roadChecks() {
    return structuredClone(scene?.data.roadChecks || []);
  },
  get roadStructures() {
    return (scene?.data.structures || []).map((p) => ({
      id: p.id,
      kind: p.kind,
      triangles: p.top.indices.length / 3,
    }));
  },
  get mesh() {
    return scene?.data.mesh;
  },
};
