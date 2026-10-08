# Frontier — Road Editor

A standalone, browser-based **road editor** for the Frontier engine (Terrain Lab,
`streamlinkinbox/Frontier`). Draw a centerline over generated or imported
terrain; the editor builds a real ribbon mesh — asphalt, shoulders, lane
markings and curve banking — and exports it back to the engine.

The UI is the Frontier Terrain Lab interface: same layout skeleton, components,
viewport furniture and design tokens, as documented by the Frontier UI exhibits
in `unassignedinbox/Slate` (`ControlsPreview.html`, `ColourPicker.html`,
`Frontier/Docs/Design/`). No build step, no network access required — three.js
and the lucide icon set are vendored under `vendor/` and `src/icons.js`.

## Run

Open `index.html` directly in a browser, or serve the folder statically:

```sh
cd RoadEditor
npm start            # python3 -m http.server 5173
# → http://localhost:5173
```

Any static file server works (`npx serve`, `python3 -m http.server`, …). To use
it inside the Frontier Vite app, copy this folder into the app's `public/`
directory (e.g. `public/road-editor/`) and link to `/road-editor/`.

## Test

```sh
npm test             # node --test — geometry, serialization and UI-wiring checks
```

## Using the editor

- **Add points** mode: click the terrain to extend the centerline. Points snap
  to the surface height (toggle **Snap to terrain**).
- **Select & move** mode: click a handle to select it, drag to move it.
- **Del** deletes the selected point, **I** inserts one after it, **B** builds,
  **Ctrl+Z / Ctrl+Y** undo and redo, **Esc** clears the selection.
- Road parameters (width, lanes, shoulder, banking, smoothing, station spacing,
  markings, closed loop) apply with **Build road**, mirroring the engine's
  Generate button. Point edits rebuild live.
- Elevation modes: **Follow terrain** (draped, default), **Constant height**
  (viaduct), **End-to-end grade** (straight ramp between the ends).
- The status line reports validation: overlapping points, too-short roads,
  self-crossing centerlines and grades above ~12%.
- Everything autosaves to `localStorage` and is restored on reload.

### Terrain

- **Procedural heightfield**: seeded, deterministic, mapless (integer-hash
  value noise + ridges, faded to sea level at the borders). Same seed, same
  terrain, on any platform.
- **Loaded engine mesh (.obj)**: export a mountain or quarry from the Terrain
  Lab (**Export mesh**), load it here, and the road drapes onto the real engine
  geometry via raycasting.

### Export

- **Export road mesh (.obj)** — Y-up, meter-scale OBJ of the ribbon
  (`Road_Asphalt`, `Road_Shoulder`, `Road_EdgeLines`, `Road_LaneDividers`),
  with parameters and stats in the header comments, matching the engine's OBJ
  export conventions. Geometry only, like the engine's exports.
- **Save / Load road project (.json)** — `frontier-road` v1: name, control
  points, parameters, stats and terrain settings. Reload it here to keep editing.
- **Screenshot** — PNG of the viewport.

## File formats

`frontier-road` project (v1):

```json
{
  "format": "frontier-road",
  "version": 1,
  "units": "meters",
  "up": "Y",
  "name": "Untitled road",
  "points": [{ "x": 0, "y": 0, "z": 0 }],
  "params": { "width": 7, "lanes": 2, "shoulderWidth": 1.5, "banking": 60,
              "maxBankAngle": 8, "smoothing": 65, "sampleLength": 2,
              "markings": true, "closed": false, "elevation": "follow",
              "rideHeight": 0.15 },
  "stats": { "length": 0, "maxGradePct": 0, "triangles": 0 },
  "terrain": { "source": "procedural", "seed": 28491, "size": 400,
               "height": 28, "roughness": 55 }
}
```

## Layout

```
RoadEditor/
  index.html            page skeleton (engine layout)
  src/style.css         engine stylesheet, ported + road-editor additions
  src/main.js           app: scene, interaction, panel wiring, import/export
  src/spline.js         pure centerline math (PRNG, sampling, curvature, validation)
  src/terrain.js        pure seeded heightfield sampler
  src/road.js           pure ribbon mesh builder, project JSON, presets
  src/icons.js          inlined lucide icons (same set as the engine)
  vendor/               three.js r180 + OrbitControls/OBJExporter/OBJLoader
  tests/                node --test geometry + integration suites
```

## Notes and limits

- The ribbon is triangle geometry with per-station cross sections; banking is
  superelevation (outer edge raised on curves, up to the max bank angle).
- OBJ export contains baked geometry, not materials or the centerline spline;
  reload the `.json` project to keep editing the points.
- Draping onto very large imported meshes is raycast-based and may take a
  moment on **Build road**.
- This is an authoring tool, not a traffic or road-network simulation.

## Credits

UI, layout and conventions follow the Frontier Terrain Lab
(`streamlinkinbox/Frontier`, branch `arena/471659c9-frontier`) and the Frontier
UI exhibits in `unassignedinbox/Slate` (branch `arena/01a0fd48-slate`).
Icons are [lucide](https://lucide.dev) v0.468.0 (ISC), inlined. Rendering uses
[three.js](https://threejs.org) r180, vendored (MIT).
