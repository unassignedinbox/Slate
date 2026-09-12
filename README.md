# Terrain Foundry

A dependency-free HTML prototype for a professional SDF landscape authoring tool.

## Run

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Open `http://localhost:4173/` in a WebGL2-capable browser.

## What is implemented

- Dark outliner / inspector / node-graph UI inspired by the supplied SolidArc and Celestial references.
- WebGL2 raymarched signed field with subtractive cave capsules, overhang shelves and material shading.
- GPU-visible signed material delta texture: positive values detach terrain, negative values settle sediment.
- Realtime rain, river and wind particles with capacity, evaporation, one-way erosion and deposition.
- World-space animated river shader that follows the same meander/current field used by particles.
- Diagnostics view, debug views, camera orbit/dolly, reset and `.terrain.json` export.
- Research and production requirements: [`docs/terrain-requirements.md`](docs/terrain-requirements.md).

This is an authoring preview, not a GTA-scale runtime. The docs describe the production handoff: hybrid heightmap + sparse SDF chunks, GPU compute passes, deterministic graph evaluation, streaming, LOD and engine export.
