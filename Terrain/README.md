# Slate Terrain

A terrain and texturing app built as a **layer stack** (Substance Painter / Photoshop style, not a node graph).
Each layer does one operation and has an influence mask (Gaea-style grayscale), a blend mode, and an opacity.
Terrain shaping and surface texturing run in one pipeline. The heightmap is the primary format, and the voxel
form is derived from it. Rivers and lakes carve into the heightmap. Water is a transparent fill inside the carved
depressions, not an overlay mesh.

## Run

```
npm install
npm run dev      # 0.0.0.0:5173
npm test         # engine checks: catalogue numbering, every layer runs, presets, carving, masks, hydrology, voxels
npm run build
node scripts/render-samples.mjs samples 192    # PNG previews of the presets (samples/ is git-ignored)
```

## Layout

- `src/engine/` the engine. `registry.js` holds the 240-entry catalogue. `stack.js` evaluates the stack.
  `document.js` holds the document model, presets and save/load. `voxels.js` derives the voxel form.
- `src/view/` 2-D canvas (`viewport2d.js`) and 3-D view (`terrain3d.js`).
- `src/ui/` controller (`app.js`) and styles.

## Catalogue

| Range | Category | Count |
| --- | --- | --- |
| 1–28 | Primitives | 28 |
| 29–52 | Shapes | 24 |
| 53–69 | Erosion | 17 |
| 70–84 | Geology | 15 |
| 85–94 | Water | 10 |
| 95–128 | Filters | 34 |
| 129–152 | Combiners | 24 |
| 153–178 | Masks | 26 |
| 179–203 | Color / texturing | 25 |
| 204–216 | Transforms | 13 |
| 217–235 | Utility | 19 |
| 236–240 | Vegetation | 5 |

Each definition has `status: 'full' | 'approx'`. `approx` marks simplified physics: 59 Wind, 61 Coastal,
62 Cascade, 65 Snowmelt, 68 Rain Erosion.

## Conventions

- Heights are `Float32Array(N·N)`, index `y·N + x`, unit range [0, 1]. `heightScale` maps unit height to metres.
- Colour is `Float32Array(3·N·N)`, interleaved RGB.
- Layer outputs: `{height}`, `{color, alpha?}`, `{map:{name,ch,data}}`, `{maps:[...]}`, `{water}`, `{scatter}`, `{stats}`.
- Export: 16-bit little-endian raw heightmap (`.r16`), which is git-ignored.
