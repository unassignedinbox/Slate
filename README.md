# Slate — Terrain Layer Stack

A Gaea-equivalent **terrain + texturing layer stack** in a single unified pipeline.
Not a node graph: layers stack like Substance Painter / Photoshop — bottom applies
first, the top row is the foreground. Every layer has **blend mode + opacity + an
optional Gaea-style grayscale mask**.

- **Terrain format:** heightmap (primary, `Float32Array`) + voxelized (derived on demand)
- **Pipeline:** terrain shaping and surface texturing live in the same stack
- **Water:** rivers, lakes, ponds, waterfalls, deltas and oceans **carve real
  channels/basins into the heightmap**. Water is a transparent fill rendered inside
  the carved depressions — never a blue mesh laid on top
- **Zero build step:** static files + Three.js from CDN, runs from any static host

## Run it

```bash
npm run dev      # serves http://localhost:8080 — open index.html
npm run smoke    # headless test: executes all 240 items
```

Open `index.html` (via any static server — ES modules need `http(s)`).

## The 240 items

| # | Group | How it exists in the stack |
|---|-------|----------------------------|
| 1–28 | Primitives / base generators | Layer types (`src/engine/layers_primitive.js`) |
| 29–52 | Shape generators | Layer types (`layers_shape.js`) |
| 53–69 | Erosion | Layer types — droplet hydraulic, thermal talus, wind, glacial, coastal… (`layers_erosion.js`) |
| 70–84 | Geological / tectonic | Layer types (`layers_geo.js`) |
| 85–94 | Water features | Layer types that **carve** + set the water level (`layers_water.js`) |
| 95–128 | Filters / modifiers | Layer types (`layers_filter.js`) |
| 129–152 | Combiners / blend modes | **Blend mode dropdown on every layer** (`blend.js`) — this is the stack-native equivalent of Gaea combiner nodes |
| 153–178 | Masks | **Mask dropdown on every layer**, incl. user-painted (`masks.js`) |
| 179–203 | Color / texturing | Layer types writing albedo/roughness/AO/flow/moisture/snow… (`layers_color.js`) |
| 204–216 | Transforms | Layer types on height + color (`layers_transform.js`) |
| 217–235 | Utility | Layer types: cache, output, input/file-import, export, view, compare, 3D view, stats, switch, gate, merge, split, channels, color space… (`layers_utility.js`) |
| 236–240 | Vegetation / scatter | Layer types: instanced trees/rocks/grass, density, biomes, tree/grass lines (`layers_veg.js`) |

`scripts/smoke.mjs` asserts the 1–240 coverage has no gaps/dupes and executes every
layer, blend and mask headlessly (277 assertions).

## Layer anatomy

```
bottom ── applies first ──────────────────────────────► top (foreground)
each layer:  generate/transform ──► mask ──► blend+opacity ──► stack
```

- **Targets:** layers declare which buffers they write
  (`height`, `alb`, `rough`, `moist`, `snow`, `flow`, `ao`).
- **Masks:** any of the 26 mask types on any layer, with its own parameters.
  `Custom Painted` opens viewport painting (red overlay = masked).
- **Utility markers:** `View`, `Compare`, `3D View` steer the viewport; `Cache` +
  `Merge` combine across time; `Stats`/`Histogram` report into the inspector.

## Views & export

- **3D** (textured/clay/height/wireframe), water plane, instanced scatter
- **Maps**: height, color, flow, slope, AO, moisture, normal
- **Voxel**: derived column-voxel preview with water columns
- **Compare**: split view vs stack start or any cache slot
- Export: height/albedo/normal PNG, OBJ mesh, float32 RAW, project JSON
  (projects autosave to localStorage, painted masks included)

## Layout

```
index.html  style.css
src/engine/  util, noise, blend, masks, layers_*, registry, stack, voxel  (pure JS, DOM-free)
src/ui/      app.js (shell/panels), viewport.js (three.js + 2D + paint + export)
scripts/     smoke.mjs
```

Only `src/ui/*` touches the DOM or Three.js — the engine is fully headless-testable.
