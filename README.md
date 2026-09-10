# SLATE — SDF Terrain Studio

Node-based volumetric terrain tool in the browser. **True SDF terrain** (caves,
arches, overhangs, cliffs — not a heightmap), eroded in realtime by **GPU
particle agents**: rain, rivers, wind and thermal weathering, with mass-aware
sediment transport, settling, and a **water shader advected by the simulated
flow field**. Built for AAA-grade worldbuilding look-and-feel; WebGL2 only.

![stack](https://img.shields.io/badge/WebGL2-float%20volume-4fd8e0)

## Run

```bash
python3 -m http.server 8080     # or: npx serve
# open http://localhost:8080
```

No build step, no dependencies, fully offline. Requires a WebGL2 context with
`EXT_color_buffer_float` (any desktop Chrome/Edge/Firefox/Safari 16+).

## Workflow (Gaea-style, realtime)

1. Start from **Sources** — `Terrain Mass`, spheres, capsules, cones…
2. Shape with **Patterns** — Ridged, FBM, Domain Warp, Terrace, Slope.
3. Combine with **Operators** — union / subtract / intersect (smooth variants).
4. Chain **Erosion** nodes — Hydraulic, River, Wind, Thermal.
5. Press **Space** and watch agents cut, carry, and settle into the terrain —
   particles are small, they **deposit their load and retire** (acceptance
   clamps + cumulative cut caps mean no runaway hole-cutting).
6. Drop a `Subtract → Sphere` *after* an erosion node to carve cave entrances
   into the eroded result — downstream CSG re-applies analytically.

## Shortcuts

| | |
|---|---|
| `Space` run/pause · `.` step · `B` rebuild | `Tab` graph drawer · `L` tidy |
| `1`–`6` view modes (shaded/albedo/normal/occupancy/sediment/flow) | `F` frame |
| right-click graph = add node · `⌫` delete · `Ctrl+D` duplicate | `?` help · `` ` `` diagnostics |

## Architecture

```
src/
  core/
    config.js       volume tiers (128³…192³), world scale
    glutil.js       WebGL2 programs/FBOs/float textures
    volume.js       RGBA32F Z-slice atlas ping-pong + graph bake
    graph.js        node registry + GLSL codegen (field-boundary compilation)
    sim.js          pass orchestration: motion → event → scatter → accept →
                    feedback → repair → thermal → flow map
    renderer.js     raymarched SDF terrain + water + particle sprites
    camera.js       orbit / pan / dolly with inertia
    glsl/           atlas sampling, sim shaders, render shaders, bake template
  ui/               glass OLED panels mirroring the SolidArc / Slate kit
  presets.js        Highlands·River / Cave Coast / Canyon Run / Dune Sea / Badlands
  exporter.js       screenshot · 16-bit heightmap · flow map · graph save/load
docs/EROSION.md     the erosion model, research basis and limits
tools/check-glsl.mjs  static GLSL + codegen checks (node tools/check-glsl.mjs)
```

The simulation runs entirely on the GPU (fragment passes, MRT, instanced
scatter). Research basis and the step-by-step model are documented in
[docs/EROSION.md](docs/EROSION.md).
