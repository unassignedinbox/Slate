# Slate — Terrain & Texturing Layer Stack

A browser app for building terrain. It is a **layer stack**, not a node graph. Each layer performs one
operation (generator, erosion pass, filter, water carve, mask, texture splat, transform, utility) and has a
blend mode, opacity, and an optional grayscale **mask**. Terrain shaping and surface texturing run through the
same stack.

Built from scratch. The UI reference branch was consulted for panel layout only; no code was copied.

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (bound to 0.0.0.0)
npm test           # engine tests (node --test)
npm run build      # production bundle in dist/
npm run render     # writes height/albedo PNG previews of the starter stack to ./preview
npm run docs       # regenerates docs/NODE_STATUS.md from the registry
```

## Architecture

| Path | Role |
|---|---|
| `src/engine/registry.js` | Every node (Gaea ids 1–240, plus extra id 241): name, category, mode, parameter schema, run function |
| `src/engine/stack.js` | Stack evaluator: applies layers bottom→top with blend, opacity, and mask |
| `src/engine/generators.js` | Primitives (1–28), gradients and shapes (29–52) |
| `src/engine/erosion.js` | Erosion solvers (53–69): droplet hydraulics, thermal, stream-power, wind, glacial, etc. |
| `src/engine/geology.js` | Geological / tectonic nodes (70–84) |
| `src/engine/water.js` | Water nodes (85–94). Each **carves** into the heightfield and records a water surface level |
| `src/engine/ops.js` | Blend modes (129–152), filters (95–128), transforms (204–216) |
| `src/engine/masks.js` | 26 Gaea-style influence masks (153–178) computed from live terrain |
| `src/engine/color.js` | Colour / texturing (179–203): albedo and named material maps |
| `src/engine/utility.js` | Utility (217–235) and vegetation/scatter (236–240) |
| `src/engine/derived.js` | Cached slope, curvature, flow accumulation (D8 on a depression-filled surface) |
| `src/engine/io.js` | PNG16 / PNG8 / RAW16 export, RAW16 / image import |
| `src/engine.worker.js` | Runs the stack off the main thread; stale results are dropped |
| `src/ui/*` | Layer panel, add-node dialog, property/mask panel, 2D map, 3D terrain, voxel view |

### Layer model

- Layers are stored bottom (index 0) → top. The panel lists the top layer first.
- **Height layers** (generator, modifier, combiner) change the heightfield. Generators are blended with the layer's
  Gaea combiner blend mode. Modifiers are interpolated by `opacity × mask`.
- **Colour layers** write albedo with their blend mode. **Map layers** (Normal, Roughness, AO, Flow, Moisture,
  Snow, etc.) write named channels to `st.maps`.
- **Transform layers** remap the whole state (height, albedo, water, maps).
- **Mask layers** (153–178 as standalone nodes) feed the next layer. Every layer can also take its own inline
  mask, with contrast, feather, and invert. Mask 178 (Custom Painted) is painted directly in the 2D view:
  left-drag paints, shift-drag erases.
- **Water** is never a blue mesh on top of the terrain. Water nodes lower the bed, and the water surface is kept
  only where it sits at or above the carved bed. The 3D view draws a transparent surface only in those cells.
- **Voxels** are derived from the heightfield. Columns are sampled to ≤96² with 40 height levels, and exposed
  faces are drawn as instanced cubes. A raw 8-bit voxel grid can be exported.

## Status

See `docs/NODE_STATUS.md`. All 241 registered nodes run and are covered by the test suite (every node
executes on a 64² state and returns finite values). **78 nodes are marked approximate** because they are
heuristic or simplified versions of the named Gaea behaviour. Expect a different look from QuadSpinner output.

Known limitations:
- Not visually QA'd in a browser in the build environment. Verified by: the Vite build, dev-server module
  serving, jsdom DOM smoke tests of the panels, and the engine tests.
- Lake defaults are conservative. Selecting lake basins on noise-driven terrain can flood large areas, so the
  starter stack omits Lake.
- Evaluation is a full re-run of the stack. At 512² with droplet erosion, expect seconds per change.
- No ray-traced or GPU-based erosion. Droplet erosion runs on the CPU.
- EXR import is not supported. Imports accept 8-bit PNG/JPG (via canvas) and 16-bit RAW.
