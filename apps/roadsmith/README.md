# Roadsmith

A WebGPU road-network generator that builds **real road anatomy** — not ribbons with a line texture.
Everything you see is generated geometry: carriageway, gutters, kerb units, footways, kerb returns,
junction plates, city blocks, bridges, tunnels, railway, props and traffic. There is no build step,
no bundler and no asset pipeline: open `index.html` and it runs.

```
python3 -m http.server 8080        # or: npm run dev
# then open http://localhost:8080
```

Needs a WebGPU browser (Chrome/Edge 113+, Safari 18+, Firefox with `dom.webgpu.enabled`).
The generator itself is headless and runs in Node — see **Verification** below.

---

## What it makes

| Area | What is actually generated |
| --- | --- |
| Alignment | Centripetal Catmull-Rom curves with an arc-length LUT; curvature-adaptive stationing (2.0–4.0 m straight, down to 0.6 m in tight curves, ≤1.1 m near a junction mouth) |
| Cross section | Per-class slot model — shoulder / parking / lanes / median / lanes / parking / shoulder — with camber, gutter channel, battered kerb face, kerb top, verge and footway cross-fall |
| Junctions | Mitre + fillet solve per corner, 6-band kerb returns, and one **welded** junction plate. True Y and `+` merges, never stacked ribbons |
| Markings | Lane dashes, edge lines, double centre lines, stop bars, zebras, turn arrows, parking bays — painted in the shader from the real lane band carried in the vertex stream |
| Condition | Potholes, sunken patches, speed tables, excavated roadworks trenches, polished wheel paths, gutter grime — all displaced geometry plus a per-vertex wear channel |
| City | Closed city blocks extracted from the half-edge faces of the graph, welded to the kerb line, paved with seven bonds (no buildings, by design) |
| Terrain | A carved apron, not a flat plane: the ground lattice is cut away wherever a road corridor or block sits, and a graded shoulder is extruded from the exact outer verge vertex so grass meets kerb with no seam, no gap and nothing buried. Viaducts and tunnels are skipped so the land passes under them |
| Structures | Bridge decks, parapets, piers, retaining walls, tunnel portals/linings and a cut-and-cover subway bore |
| Rail | Ballast, sleepers and UIC rail; the permanent way breaks and re-lays through each level crossing, with road plates, flangeways, booms and warning lights |
| Props | Streetlights, traffic signals, signs, 4 bollard designs, guardrails and pedestrian railings, billboards, shelters, benches, cones, barriers |
| Drainage | Gully grates and side-entry kerb inlets (one style per kerb line), plus manhole covers sampled on the road crown rather than dropped on a flat world plane |
| Traffic | IDM car-following, signal phases, conflict-point yielding, turn choice, suspension that reads the road surface, trains, and level-crossing interlocking. Hard cap **25 vehicles** |

---

## The topology rules it holds to

Roads are **quads first**. The audit is part of the repo, not a claim:

```
$ node tools/validate.mjs --scene

network        downtown · 51 nodes · 68 roads · 29 junctions · 9.04 km
road surface   135,296 verts · 128,742 quads · 257,492 tris
welds          5,139 vertices fused during build
quad warp      p50 0.000 · p99 0.075 · max 0.637
whole scene    407,445 verts · 349,282 quads · 705,506 tris · 99.0% quad
city           19 blocks · 5 level crossings · 90 parked · 18 AI vehicles

  ✓ finite geometry — 0 NaN components
  ✓ quad-dominant topology — 100.00% of triangles come from quads
  ✓ no degenerate quads — 0
  ✓ no duplicated faces (no stacked geometry) — 0
  ✓ manifold edges (<=2 faces per edge) — 0 over-used edges
  ✓ quads near-planar (p99) — p99 0.075 · max 0.637
  ✓ junction seams welded — 545 coincident vertices (surface-id splits only)
  ✓ vertex normals valid — 0 problems
  ✓ props + city quad-dominant — 98.5%
  ✓ fleet never exceeds 25 vehicles · no permanently stuck vehicles · traffic flows
  ✓ city blocks closed — 19 blocks
  ✓ sign plates stand vertical — 0/512 faces lying flat
  ✓ junction signs face oncoming traffic — 196 aimed at traffic · 0 aimed away
  ✓ vehicles drive nose first — 0/18 reversed
  ✓ lane graph connected — 186 lanes · 371 turns
  ✓ terrain never covers the road surface — 69,795 road points checked
  ✓ terrain never covers a junction plate — 0/1,064 plate samples buried
  ✓ moved junction stays finite / manifold / welded / quad-dominant
```

All four presets (`downtown`, `riverside`, `interchange`, `industrial`) pass the same audit:
`npm run validate:all`.

* **One mesh at the centre.** Where roads meet, the ribbons stop at a solved mouth station and the
  junction plate takes over. Plate, kerb returns and both ribbons share vertices — the weld key is
  quantised position + surface id, so the only "coincident" vertices left are deliberate material
  splits (e.g. asphalt vs. kerb at the same point, which need different normals/ids).
* **No layering.** `|` over `-` is impossible by construction: an intersection is a single plate
  polygon built from the actual mouth rows and fillet arcs. Grade separation is explicit
  (`structure: 'bridge' | 'tunnel'`), never implicit overlap.
* **All-quad plate fill.** The plate is filled with concentric quad rings plus a midpoint fan
  (a "spider"). The single centre vertex is the only high-valence pole in the whole road shell.
* **Triangles only where unavoidable** — a quad whose two ends collapse (a fillet that closes to a
  point) degrades to one triangle instead of a zero-area quad. That is the 1.7 % in prop meshes.

---

## The interchange

The grade-separated junction is built to published geometric standards rather than by eye — FHWA's
interchange prompt list, Caltrans HDM ch. 500, MoDOT 234.2 and the MassDOT interchange guide:

| | |
| --- | --- |
| Deck | 7.2 m clearance over the cross road, 1.6 m structure depth (0.65 m slab + 0.95 m girders), 48 m spans |
| Girders | spaced 2.325 m across the deck — 5 under an 11.3 m carriageway, scaled with deck width |
| Grades | 4 % on the mainline approach, 6 % maximum on a ramp, 0.25 m grade-join tolerance |
| Spacing | 260 m between the two ramp terminals, 95 m between the two gores on one side |
| Widths | 3.65 m motorway lanes, 3.0 m shoulders, 3.7 m ramp lane, 1.5 / 2.5 m ramp shoulders |

The ramps deliberately **do not share a node with the motorway**. A ramp leaves at about five
degrees, and a junction solver asked to fillet two near-parallel kerbs will happily pave a 250 m
asphalt blob where the gore should be. Real gores work the other way round: the ramp starts
*beside* the mainline with its shoulder touching, tapered to a physical nose, and the gap opens as
it peels away. So each ramp gets its own gore node, offset laterally by the two outer half widths
and capped with a wedge (`node.cap = 'nose'`). Nothing overlaps, nothing is filleted, and the land
between them stays grass to the kerb.

The same rule drives the city blocks: a block face that fronts a motorway or ramp is flagged as a
gore and gets grass up to the kerb — no footway apron, no parking bays.

---

## Editing

* **Click an intersection** (viewport or the Intersections group in the outliner) to select it.
* **Drag the gizmo** — red/blue axis arrows for X/Z, the blue disc for free movement, `Shift` snaps
  to 1 m. The *whole* junction moves: the node, every incident road, their control points (soft
  drag so the alignment bends instead of kinking), the kerb returns and the plate are re-solved as
  one mesh when you let go.
* The inspector edits control type (signals / stop / give-way / uncontrolled), crosswalk policy,
  corner-radius override and exact coordinates; roads expose class, lane counts, widths, median,
  footways, speed limit, wear, structure and damage features.

| Input | Action |
| --- | --- |
| LMB drag | Orbit · `Shift`+LMB or MMB/RMB pan · wheel zoom |
| LMB click | Select intersection / road · `Esc` deselect |
| `F` | Frame selection (or the whole network) |
| `G` | Regenerate · `Q` quad wireframe · `L` lane graph · `Space` pause traffic |

## The two layer stacks

The right column is split: **layer stack on top, inspector underneath**, exactly like the
Frontier/ProjectZero editor language (43 px rows, accent bar on the selected row, hover eye button,
card-based inspector). No node editor anywhere — toggles, sliders and selects only.

1. **Scene** — generated geometry grouped as Network / Structures / Rail / Furniture / Dynamic,
   each row with triangle counts and a visibility eye, followed by every intersection in the graph.
2. **Texturing** — 16 material channels (asphalt, gutter, markings, kerb, footway, tactile, verge,
   soil, block paving, concrete, steel, permanent way, plastics, glass, emissive, vehicle paint).
   Roads are generated first and textured second: each channel owns a set of the 50 surface ids and
   drives albedo, roughness, metallic, pattern scale, detail, normal relief, wear response, water
   pooling, emissive and — for paving — the bond (slabs, running bond, herringbone, basketweave,
   hex setts, cobble setts, flagstone). Switching a channel off falls back to flat colour so you can
   see exactly what it contributes.

---

## Rendering

Single forward pass with a 2048² sun shadow map (PCF 3×3), MSAA ×4 into an `rgba16float` target,
then a graded resolve (ACES, contrast/saturation/lift, vignette, grain, light sharpen).

* Materials are **procedural in WGSL** — twelve families (asphalt, concrete, paving, grass,
  aggregate, metal, paint, glass, emissive, rubber, tactile, water) with worley aggregate, fbm
  grime, broom finish, mortar joints, brushed metal and rust, plus analytic normals from the
  height field. No textures are loaded.
* Markings are painted from the vertex stream: `uv = (metres along, metres across)`, the lane band,
  the per-vertex flag word (parking/one-way/centre-double/crosswalk/stop-bar/construction/rail) and
  the signed distance to the junction mouth.
* Signal lenses are static geometry: each lens vertex carries its signal group and lens index, and
  the shader reads the live controller state out of a uniform — the simulation lights the junction.
* Up to 48 street lights are selected per frame on the CPU and fed to the punctual-light loop
  (they switch on with the night factor).
* Vehicles, wheels, trains and barrier booms are GPU-instanced with a 12-float instance record
  (position + yaw, paint, spin/scale/lift/emissive).

---

## Layout

```
index.html                 no bundler, ES modules only
styles/editor.css          editor theme
src/core/     math, rng, spline, mesh builder, quad primitive kit, camera
src/road/     profile → network → section → junction → roadmesh → build
              props, structures, rail, blocks, generator, scene
src/sim/      vehicles (lofted shells), traffic (lane graph, IDM, signals, trains)
src/gfx/      renderer.js, materials.js, shaders/{common,surface,sky,post,overlay}.js
src/ui/       shell, layerstack, inspector, widgets, icons
src/app/      state (editor model), gizmo (picking + overlay), frame (sim → GPU)
tools/        validate.mjs, wgsl-check.mjs, dev/*.mjs
```

Hard rule: everything under `core/`, `road/` and `sim/` is DOM-free and GPU-free, so the whole
generator imports and runs in Node. Only `main.js`, `ui/*` and `gfx/*` touch the browser.

## Verification

The app needs no install to run. `npm i` only pulls the dev-only checkers (`naga-wasi-cli`,
`wgsl_reflect`), and then:

```
npm run check                      # everything below, in order

node tools/wgsl-check.mjs          # type-checks all 5 WGSL modules with naga (the wgpu/Firefox
                                   #   front-end) + binding reflection with wgsl_reflect
node tools/dev/import-check.mjs    # every module imports against a DOM stub; renders both layer
                                   #   stacks and every inspector panel
node tools/dev/gpu-smoke.mjs       # drives the real renderer against a recording WebGPU mock:
                                   #   buffer alignment/overflow, attribute vs. stride, index
                                   #   overrun, resolve targets, bind groups, picking maths
node tools/dev/app-boot.mjs        # boots src/main.js headlessly (DOM stub + GPU mock + driven
                                   #   rAF) and plays a session: click an intersection, drag the
                                   #   gizmo, wait for the deferred rebuild, toggle every layer,
                                   #   cycle the lighting presets, edit a texture channel, author
                                   #   potholes/works, hit every shortcut — asserting zero errors
node tools/validate.mjs            # 7-node reference network, junction topology
node tools/validate.mjs --scene    # full city: geometry, traffic soak, gizmo-drag rebuild
node tools/validate.mjs --scene --preset interchange --seed 42 --verbose
npm run validate:all               # the same scene audit over all four presets
```

There is no headless WebGPU in CI, so layout is reviewed from a renderer-free orthographic plan:

```
node tools/dev/plan.mjs downtown 1100            # → /tmp/plan.raw  (y-buffered, surface-coloured)
python3 tools/dev/plan.py 1100 /tmp/plan.png     # → PNG
node tools/dev/plan.mjs interchange 900 --zoom=530,0,110
```

Anything the plan draws in black is geometry that does not exist — which is how the apron holes
beside the motorway were found.

`--scene` also runs 30 s of traffic (checks for NaN poses, the 25-vehicle cap, stuck vehicles),
then drags a live intersection 16 m and re-audits the rebuilt mesh. In the browser the live
editor is on `window.roadsmith` (`editor`, `camera`, `renderer`, `api`) for console poking.

## Known limits

* Moving an intersection rebuilds the scene on pointer-up (~1.5 s for a 8.5 km network); the edit
  is deferred and shown with a progress overlay rather than rebuilt per-frame.
* The junction plate keeps one high-valence centre vertex per intersection (the quad spider pole).
* Blocks are paving only — buildings are deliberately out of scope.
