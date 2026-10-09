# Landscape editor

A browser heightmap editor built on a layer stack. Each layer is a base shape, a relief generator, an erosion solver or
a shaping operation, and every layer can be gated by masks. The terrain is solved in a Web Worker and rendered with
WebGL2. The satmap colours the terrain from the solved fields, so rivers, sediment, slope and protrusion all show.

## Run it

```sh
npm install
npm run dev      # http://localhost:5180 (bound to 0.0.0.0)
npm test         # solver, cache, preset and I/O checks
npm run build    # production bundle in dist/
```

## Layout

- **Layer stack** (left): the top of the list is applied last. Toggle, reorder, duplicate or delete layers. The family
  buttons pick the kind of layer to add.
- **Viewport** (centre): satmap or shaded view, satmap mode dropdown, optional mask preview, orbit with drag and wheel.
- **Inspector** (right): the selected layer's name, type, combine mode, opacity and seed. Below those are the sliders
  for its type, then its masks. With no layer selected it shows the terrain settings: grid resolution, extent and sea
  level.

Undo and redo are Ctrl+Z and Ctrl+Shift+Z. A drag on one slider is a single undo step. The project autosaves to local
storage. Save and Open use JSON project files. Heightmap PNG exports a 16-bit greyscale PNG.

## Layer families

| Family | Kinds | Combine |
| --- | --- | --- |
| Base shape | Perlin fBm, multifractal, ridge, mountain, billow, cellular plateaus, terraces, tilted plane, dome | Replace |
| Relief | Same generators as base shapes | Add |
| Erosion | Hydraulic (droplet), thermal (talus), fluvial (stream power), aeolian (wind dunes), coastal (wave cut) | Replace |
| Shaping | Terrace, smooth, uplift | Replace |

Every combine mode (replace, add, subtract, keep higher, keep lower) is available on every layer.

## Masks

Coastal falloff, mountain falloff (smooth, ragged), stratified beds (dipping strata with hardness), sea stacks, rift
lines, cliff faces (slope threshold), slope band, elevation band, island radial and noise breakup. Masks read the terrain
as it stands at their position in the stack, so a coastal mask placed after a base shape follows the coastline that
shape produced. Each mask can be inverted, and its strength is adjustable.

## Satmap modes

Natural, Strata, Sedimentation, Rivers, Protrusion and Slope. The palettes are stylised, not survey accurate.

## Presets

Canyons (sandstone), Sandstone cliffs, Coastal cliffs, Himalayan mountain, Icelandic, Alps, Snowy mountains, Rugged
outcrops, Desert dunes, Rocky desert.

## Architecture

- `src/LayerSequence.js`: evaluates the stack bottom to top and caches each layer's result. Editing a layer recomputes
  only that layer and the ones above it.
- `src/GeneratorSpecification.js`, `MaskSpecification.js`, `ErosionSpecification.js`, `ModifierSpecification.js`,
  `LayerSpecification.js`: the parameter tables. Each slider is a descriptor, so the inspector and the loader share one
  source of truth.
- Solvers: `HydraulicSolver.js`, `ThermalSolver.js`, `FluvialSolver.js`, `AeolianSolver.js`, `CoastalSolver.js`.
- `src/SurfaceClassifier.js`: satmap colouring from the solved fields.
- `src/ElevationWorker.js`: runs the stack and the classifier off the main thread.
- `src/ViewportPanel.jsx`, `LayerPanel.jsx`, `InspectorPanel.jsx`, `LandscapeHost.jsx`: the React interface.
- `src/PngCodec.js`: writes 16-bit PNG with stored deflate blocks, so no compression library is needed.

## Known limits

- Aeolian dune growth is calibrated at 128 cells. At 256 cells the explicit biharmonic step is much smaller, so dunes
  need far more steps to grow. Dune presets use 128.
- Fluvial and hydraulic erosion remove sediment from the map. Only the sediment that settles on the map is counted as
  deposited, so the Eroded and Deposited figures differ.
- Hydraulic erosion at 192 cells leaves some striping on steep slopes.
- Solver defaults are calibrated by hand. They have not been tuned against real survey data.
- The PNG heightmap is uncompressed, so files are larger than a normal PNG.

## Licensing

The interface tokens and layout follow the ProjectZeroEditor shell in the Frontier repository. That repository has no
project-wide licence, and its `InspectorDepot` directory has its own NOTICE. Confirm the licence before shipping any
code or CSS copied from it.
