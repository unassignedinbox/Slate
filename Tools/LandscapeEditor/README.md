# Landscape Editor

A browser heightmap editor for building believable landscapes from layered generators, erosion and satmap paint. The layout follows the latest Frontier browser editor (`Experimental/FrontierEditor`): layer stack on the left, viewport in the centre, inspector cards on the right.

The terrain engine is pure JavaScript with no DOM or WebGL dependencies, so it can be ported to the native C++ editor later.

## Running it

```bash
cd Tools/LandscapeEditor
npm install
npm run dev        # live editor on http://localhost:5173 (binds 0.0.0.0)
npm run build      # production bundle in dist/
npm run check      # engine self-check (catalogues, NaN, determinism, layer-index reuse, views)
npm run render     # renders all ten presets to Scratchpad/LandscapeEditor/renders (not committed)
```

The 3D view needs WebGL2. Without it the editor shows a message and the 2D view still works.

## Using the editor

- **Layer stack (left).** Two ordered stacks. The height stack applies generators and erosion from top to bottom. The satmap stack paints materials over the surface in order. Each row can be selected, switched off, moved and removed. The add menus at the foot of each stack insert new layers after the selected one.
- **Viewport (centre).** 3D shows the relief lit from the sun, with the satmap draped over it. Drag to orbit and scroll to zoom. 2D shows any render mode from the View dropdown: satmap, shaded relief, elevation, protrusions, rivers, sedimentation, net erosion, slope, wetness or bedding.
- **Inspector (right).** Cards for the selected layer: its identity and mix mode, its generator or erosion type with per-type sliders, its paint material, driver and band, an optional satmap generator, its mask, and live measurements with a per-layer timing log. With nothing selected it shows the terrain settings (datum, world width, seed, sun, river threshold, stylisation) and the bedding model.
- **Top bar.** Preset (the ten named presets), resolution (128 to 512, default 256; 384 and above warn that each recompute takes longer), and a compute status pill.

Both stacks support masks and generators. A height layer's generator shapes the land. A satmap layer's generator modulates where its paint lands.

## Layer model

- **Height generators (10):** perlin (fBm), multifractal, ridge, mountain, billow, plateau, dunes, terraces, island, constant. Each has a mix mode (replace, add, subtract, keep higher, keep lower), amplitude, offset, opacity, seed and an optional mask.
- **Erosion types (6):** hydraulic (rain), thermal (talus), fluvial (stream power), glacial, aeolian, coastal. Each type has its own sliders.
- **Masks (10):** none, coastal falloff, mountain falloff (smooth altitude band), slope, cliff, bedding (stratification), rift lines, breakup noise, protrusion, radial. Masks can be inverted and feathered.
- **Satmap paint:** 19 stylised materials, placed by one of 10 physical drivers (elevation, slope, protrusion, river channels, sedimentation, net erosion, wetness, caprock bedding, distance from coast, north-facing aspect). Each band has a start, end and edge softness in the driver's units. Breakup noise and an optional generator refine the coverage.

## Presets

Canyons (sandstone canyons), Sandstone cliffs, Coastal cliffs, Himalayan mountain, Icelandic, Alps, Snowy mountains, Rugged outcrops, Desert dunes, Rocky desert landscape. Every preset ends with a shared talus-stabilisation layer, so slopes settle to natural angles.

## Architecture

```
src/engine/            pure JavaScript terrain engine (no DOM, no WebGL)
  TerrainSequence.js   buildTerrain(project, index): height stack, surface attributes, satmap, metrics
  LayerSequence.js     ordered height stack with masks, mix modes and prefix reuse
  LayerIndex.js        keyed cache of stack prefixes so edits only recompute from the changed layer
  *Specification.js    catalogues: generators, erosion, masks, satmap materials and drivers
  *Solver.js / *Integrator.js / *Structure.js   erosion and drainage kernels
  SatmapSequence.js    satmap composition; SatmapProjection.js 2D view modes
  PresetConfiguration.js  the ten presets
src/engine/ComputeHost.worker.js  runs buildTerrain off the UI thread
src/engine/ComputeQueue.js        latest-wins queue: one evaluation in flight, newest project waits
src/viewport/          WebGL2 terrain exchange and orbit camera solver
src/panels/            layer stack, inspector, viewport, control bar and parameter panels
scripts/               engine self-check and preset renders (Node)
```

Edits are debounced, sent to the worker as a project snapshot, and only the newest snapshot is evaluated. Unchanged layer prefixes come from the layer index, so changing the last layer costs one layer's time.

## Approximations and limits

The engine is a heuristic model tuned for visual plausibility and measurable behaviour, not a validated geomorphology simulation.

- **Glacial** uses an ice-flux heuristic with a snowline. Removed rock is exported, not redeposited as moraines.
- **Coastal** is platform relaxation plus cliff retreat. It is not a sediment budget.
- **Aeolian** is a single upwind sweep.
- **Drainage** uses D8 routing with jittered flats. Channel metrics depend on resolution.
- **Sediment** is tracked per erosion layer. There is no full sediment budget across the stack.
- **Satmap** is stylised, not measured. Colours are simplified palettes placed by drivers.

Measured at 256² across the ten presets, the 95th-percentile slope runs from 36 to 53 degrees and the mean slope from 15 to 32 degrees. Relief runs from 141 m (Desert dunes) to 2,213 m (Himalayan mountain).

## Conventions

Names follow CLAUDE.md §2 and §3: two-word `<Subject><Role>` names with authorised roles, and no banned words in identifiers. Platform names that cannot change (for example `event.data`, `Float32Array`, WebGL calls, React's `useState`) are the only exceptions. Files follow CLAUDE.md §4: 142-column `//=` headers with a `📦` description, 122-column `//-` banners, four-space indentation and Allman braces. `AgenticInstructions/SKILL-Naming-Formatting.md`, which CLAUDE.md §16 points to, is not present in this repository, so the rules above come from CLAUDE.md §2 to §4.

## Scratch and output

Renders and scratch diagnostics live in `Scratchpad/LandscapeEditor/` at the repository root. That folder and `node_modules/` and `dist/` are git-ignored.
