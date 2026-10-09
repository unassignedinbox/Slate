# Landscape Editor

A browser heightmap editor for building believable landscapes from layered generators, erosion and satmap paint. The layout follows the latest Frontier browser editor (`Experimental/FrontierEditor`): layer stack on the left, viewport in the centre, inspector cards on the right.

The terrain engine is pure JavaScript with no DOM or WebGL dependencies, so it can be ported to the native C++ editor later.

## Running it

```bash
cd Tools/LandscapeEditor
npm install
npm run dev        # live editor on http://localhost:5173 (binds 0.0.0.0)
npm run build      # production bundle in dist/
npm run check      # engine self-check (see Verification below)
npm run render     # renders the ten presets to Scratchpad/LandscapeEditor/renders (not committed)
```

The 3D view needs WebGL2. The 2D views use a plain 2D canvas.

## Using the editor

- **Layer stack (left).** Two ordered stacks. The height stack applies generators and erosion from top to bottom. The satmap stack paints materials over the surface in order. Rows can be selected, switched off, moved up or down, and removed. The add menus at the foot of each stack add a new layer.
- **Viewport (centre).** 3D shows the relief lit from the sun, with the satmap draped over it. Drag to orbit and scroll to zoom. 2D shows any render mode from the View dropdown (satmap, shaded relief, elevation, protrusions, rivers, sedimentation, net erosion, slope, wetness or bedding), with north at the top. The footer reports relief, slope, channel length and the eroded, deposited and exported volumes.
- **Inspector (right).** Cards for the selected layer: identity and mix mode, the generator or erosion type with its own sliders, paint material, driver and band, an optional satmap generator, the mask, and measurements with a per-layer timing log. With the terrain row selected it shows the terrain settings (datum, world width, seed, sun, river threshold, stylisation) and the bedding model. Measurements show the eroded, deposited and exported volumes for the whole stack.
- **Top bar.** Preset (the ten named presets), resolution (128 to 512, default 256) and a compute status pill. Each edit is recomputed in a worker; only the newest request is evaluated, and unchanged layers are reused.

Both stacks support masks and generators. A height layer's generator shapes the land. A satmap layer's generator modulates where its paint lands.

## Layer model

- **Height generators (10):** perlin (fBm), multifractal, ridge, mountain, billow, plateau, dunes, terraces, island, constant. Each has a mix mode (Replace, Add, Subtract, Keep higher, Keep lower), amplitude, offset, opacity, seed and an optional mask.
- **Erosion types (6):** hydraulic (rain), thermal (talus), fluvial (stream power), glacial, aeolian, coastal. Each type has its own sliders.
- **Masks (10):** none, coastal falloff, massif (smooth mountain falloff), slope, cliff, bedding (stratification), rift, breakup noise, protrusion and radial. Masks can be inverted, and several have a softness control.
- **Satmap paint:** 19 stylised materials, placed by one of 10 physical drivers (height, slope, protrusion, river, sediment, erosion, wetness, bedding, coast, aspect). Each layer has a band (low and high limits, with a softness in the driver's units), a blend mode (Paint over, Multiply, Lighten, Darken), opacity, optional breakup noise, an optional mask and an optional generator.

Shape layers stacked above the first erosion layer are treated as uplift, not as erosion. Erosion and sediment therefore describe what the erosion layers do and nothing else.

## Presets

Canyons (sandstone canyons), Sandstone cliffs, Coastal cliffs, Himalayan mountain, Icelandic, Alps, Snowy mountains, Rugged outcrops, Desert dunes, Rocky desert landscape. Each preset ends with a talus-stabilisation thermal layer, so slopes settle to natural angles.

At 256², the ten presets span 141 m (Desert dunes) to 2,161 m (Himalayan mountain) of relief, with 95th-percentile slopes of 38 to 53 degrees and mean slopes of 15 to 32 degrees.

## Architecture

```
src/engine/            pure JavaScript terrain engine (no DOM, no WebGL)
  TerrainSequence.js   buildTerrain(project, index): height stack, surface attributes, satmap and metrics
  LayerSequence.js     ordered height stack with masks, mix modes and prefix reuse
  LayerIndex.js        keyed index of stack prefixes, so an edit recomputes only from the layer it changed
  *Specification.js    catalogues: generators, erosion, masks, satmap materials and drivers
  *Solver.js / *Integrator.js / *Structure.js   erosion and drainage kernels
  SatmapSequence.js    satmap composition
  SatmapProjection.js  2D views (north at the top)
  PresetConfiguration.js  the ten presets
src/engine/ComputeHost.worker.js  runs buildTerrain off the UI thread
src/engine/ComputeQueue.js        latest-wins queue: one evaluation in flight, the newest project waits
src/viewport/          WebGL2 terrain exchange and orbit camera
src/panels/            layer stack, inspector, viewport, control bar and parameter panels
scripts/               engine self-check and preset renders (Node)
```

## Verification

`npm run check` builds every preset at 128² and checks that:

- every layer uses a known generator, erosion type, mask, material and driver, with only known parameter keys;
- every output is finite, and every view mode renders at the right size;
- two independent evaluations give identical results (determinism);
- re-evaluating an unchanged project reuses its cached layers;
- eroded minus deposited equals the exported load, to within 3%;
- the satmap view places north at the top.

On the ten presets at 256², the mass balance agrees to within about 1%.

## Approximations and limits

The engine is a heuristic model tuned for plausibility and for measurable behaviour. It is not a validated geomorphology simulation.

- **Mass and export.** Eroded minus deposited equals the load that leaves the map through its edges and the sea, and this is reported as *Exported off-map*. Deposition is limited by transport capacity and capped per step, so most eroded load is exported. Real valleys, fans and lakes keep far more sediment, so deposited volumes here are low.
- **Glacial** uses an ice-flux heuristic above a snowline. Removed rock is exported and not redeposited as moraines.
- **Coastal** is platform relaxation with cliff retreat. Mass is conserved, but the offshore sediment is not budgeted in detail.
- **Aeolian** is a single upwind sweep.
- **Drainage** is D8 routing on a depression-filled surface. Outlets are map edges and cells at or below sea level. Flats are jittered so that drainage does not line up on the grid axes.
- **Resolution.** Channel length depends on resolution, so compare it only at the same size.
- **Satmap** is stylised, not measured. Palettes are simplified, and drivers choose where each material goes.

## Conventions

Names follow CLAUDE.md §2 and §3: two-word `<Subject><Role>` names with authorised roles, and no banned words in identifiers. Platform names that cannot change (for example `event.data`, `Float32Array`, WebGL calls and React's `useState`) are the only exceptions. Files follow CLAUDE.md §4: 142-column `//=` headers with a `📦` description, 122-column `//-` banners, four-space indentation and Allman braces. `AgenticInstructions/SKILL-Naming-Formatting.md`, which CLAUDE.md §16 points to, is not present in this repository, so the rules above come from CLAUDE.md §2 to §4.

## Scratch and output

Renders and scratch diagnostics live in `Scratchpad/LandscapeEditor/` at the repository root. That folder, `node_modules/` and `dist/` are git-ignored.
