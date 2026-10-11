# Road Studio

A standalone WebGPU app that generates road networks from splines and textures them with
a layerstack. It lives in `RoadStudio/` and is independent of the "fracture" demo.

```
npm install
npm run dev        # http://localhost:5180 (WebGPU browser required)
npm test           # engine tests + WGSL parse check
npm run build      # production bundle in dist/
```

## Workflow

**1 · Network.** Draw roads as Catmull-Rom splines (`D`, click the ground, click a junction to
connect, double-click to finish, `Esc` cancels). Each junction has a gizmo: select it and drag the
arms (X, Z) or the centre to move the whole intersection. Roads that meet a junction merge into a
single hub mesh with curb returns. Edit road class, lanes, median, shoulder, kerb, sidewalk,
bridge deck, streetlights, bollards, railings, speed bumps, and potholes in the Inspector.

**2 · Texture.** The Layerstack (right) edits the carriageway (asphalt) and the sidewalk/plaza
(paving) stacks. Up to 8 layers per stack, evaluated per pixel in the fragment shader. Layer types,
blend modes (normal / multiply / add), masks (lane bands, curb edge, blotches), and per-layer
parameters are all editable.

## Layout

| Area | File |
| --- | --- |
| Document model, junction/road CRUD, demo network | `src/engine/network.js` |
| Spline paths (centripetal Catmull-Rom, arc-length) | `src/engine/path.js` |
| Road, kerb, pavement, hub, markings, props mesh build | `src/engine/roadGeometry.js` |
| Quad-first mesh builder (degenerate halves skipped) | `src/engine/mesh.js` |
| Primitives (box, cylinder, sphere, sweeps) | `src/engine/primitives.js` |
| Material ids and palette | `src/engine/materials.js` |
| Texture layer library and stack packing | `src/engine/textures.js` |
| Vehicle model and capped traffic (max 25) | `src/engine/carModel.js`, `src/engine/traffic.js` |
| Time of day | `src/engine/sun.js` |
| WGSL shaders (layers, lighting, shadows, sky) | `src/render/shaders.js` |
| Raw WebGPU renderer, shadow pass, instanced cars | `src/render/renderer.js` |
| Orbit camera, picking, uniform packing | `src/render/camera.js`, `src/render/picking.js`, `src/render/globals.js` |
| Viewport controller (input, gizmo, spline preview) | `src/render/stage.js` |
| Scene build off the main thread | `src/workers/scene.worker.js` |
| Editor UI (outliner, inspector, layerstack) | `src/App.jsx`, `src/ui/*` |

## Dev tools

- `node scripts/dump-mesh.mjs /tmp/topdown.json` writes the mesh triangles for a top-down raster.
- `python3 scripts/render-topdown.py /tmp/topdown.json out.png [cx cz half]` renders a top-down
  view without a GPU. It is useful for checking junction hubs, curb bands, and overlaps.

## Verification

- `npm test`: 15 engine tests. They cover the demo building with no topology warnings, no
  zero-area triangles, junction moves propagating to road ends, spline waypoints being hit,
  dead-end caps, the 25-vehicle cap, traffic staying on the network, texture packing, sun
  direction, camera/picking round-trip, and serialisation. A WGSL parse check uses `wgsl_reflect`.
- Demo mesh: about 85k quads and 186k triangles, 557k vertices, about 270 ms build in Node.

## Not yet included (v1 scope)

Trains, subway and tunnels, railway crossings, construction zones, billboards, robots, parking,
and automated interchange generation. Lanes and roads are not yet re-routed around each other
automatically; junction geometry is built from the spline ends.

## Licence note

The UI layout and visual language follow the Frontier `Experimental/FrontierEditor` reference.
That repository has no licence file and its NOTICE grants no rights, so no code or CSS was copied.
All code here is original.
