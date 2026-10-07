# Terrain Forge

A browser-based procedural terrain studio focused on believable cliff and escarpment meshes. It builds a high-density, exportable heightfield from layered noise, sharply defined shelf breaks, strata, erosion passes, and biome-aware material colors.

## Run locally

```bash
npm install
npm run dev
```

The Vite server binds to all interfaces so it can be used in an Arena live preview.

## What is included

- **Mesh-first cliff generator** — shelf formations use narrow, irregular falloffs for true high-density cliff faces rather than a flat texture trick.
- **Three terrain profiles** — Alpine Escarpment, Coastal Headland, and Canyon Escarpment.
- **Terrain controls** — elevation, feature scale, roughness, face intensity, strata, erosion, biome material, and deterministic seed input.
- **Natural surface treatment** — slope-aware vertex coloring, rock/scree/snow transitions, procedural bump detail, golden-hour shadows, haze, water, and boulder scatter.
- **Inspection modes** — beauty, albedo, and wireframe modes make it easy to review the generated topology.
- **OBJ export** — exports the current displaced mesh as an indexed OBJ file, ready for a DCC tool or game pipeline.

## Controls

- Drag on the terrain to orbit.
- Scroll to dolly.
- Press `G` to regenerate with the current parameters.
- Press `R` for a fresh random seed.
- Use **Export Mesh** to download the current terrain geometry.

## Build

```bash
npm run build
```
