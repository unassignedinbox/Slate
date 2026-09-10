# STRATA — SDF Terrain Lab

Node-based volumetric terrain landscaping for AAA-quality game worlds. Unlike
heightmap tools (which cannot represent caves, arches, cliffs or overhangs),
STRATA sculpts a true **signed-distance-field volume** and erodes it with
**live particle simulation** — droplets you can watch cutting channels,
settling sediment, and feeding rivers in real time.

Open `index.html` through any static server (ES modules + CDN import map):

```bash
cd Slate && python3 -m http.server 8000
# -> http://localhost:8000
```

## Workflow

1. **Build** — chain `Sources → Modify → Combine → Carve` nodes in the graph.
   Double-click empty canvas to quick-add; drag sockets to connect.
2. **Erode live** — append Hydraulic / Thermal / Wind nodes, press `Space`.
   - 🟠 orange drops cut · 🔵 cyan drops settle · 🔵 blue drops are airborne (waterfalls)
3. **Rivers** — high-discharge droplet trails are extracted into animated river
   ribbons; the water shader scrolls along the live flow field. Droplets that
   reach lakes/seas dump their load as sediment.
4. **Wind** — sandblasts windward faces, drops dunes in leeward shadows.
5. **Inspect** — keys `1–7`: solid / clay / height / slope / flow / hardness /
   normal. `Cut` slices the volume open to reveal cave systems.
6. **Export** — OBJ mesh, heightmap PNG, flowmap PNG (drives engine water
   shaders), project JSON.

## Why it doesn't drill to the void

Every droplet runs a capacity model (Hansson-style, adapted to SDF gradients)
with evaporation, slope/speed capacity, a sediment cap — and, crucially,
**forced settling**: on death (old age, still water, flat ground, lake entry)
the remaining load is deposited locally. The status bar shows live
`Eroded ▸ Deposited · Δ` mass balance so you can see conservation.

## Architecture

| File | Role |
|---|---|
| `index.html` / `css/style.css` | DCC shell: outliner·viewport·inspector + node graph |
| `js/noise.js` | Seeded RNG, Perlin/fbm/ridged/voronoi |
| `js/sdf.js` | SDF volume (d / hardness / flow / sediment), sampling, splats, CSG |
| `js/erosion.js` | Droplet / thermal / wind sims, river capture, 2D flow map |
| `js/graph.js` | Node defs, procedural operators, delta-replay evaluator, presets |
| `js/mesher.js` | Surface-nets mesher + river ribbons + heightfield scan |
| `js/viewport.js` | Three.js terrain/water/river/particle shaders, camera |
| `js/editor.js` | Canvas node-graph editor |
| `js/ui.js` | Panels, transport, export, sim loop |

Erosion nodes simulate against the live field while recording **deltas**, so
geometry edits rebuild underneath without losing baked erosion, and sims can
be reset per node. Headless-tested: `node /tmp/strata-test.mjs` (DOM-free core).
