# Landscape Editor — heightmap layer-stack prototype

Browser design study for a heightmap-based landscape editor built on a **layer
stack**, wearing the Frontier Editor UI (outliner / inspector shell,
Construct-style add menu, graphite cards).

```sh
# Serve this directory (any static server works)
python3 -m http.server 8080
# open http://localhost:8080/
```

No build step — plain ES modules + WebGL2.

Dev scripts (Node ≥ 18):

```sh
node scripts/smoke.mjs          # evaluate every preset through the full pipeline
node scripts/render-previews.mjs  # write /tmp/preview-*.png satellite-style renders
```

## Workspace

- **Left · Layer Stack** — ordered height layers (bottom → top): generators,
  erosion simulations and filters, plus the satmap stack. Visibility toggles,
  search, `Shift+A` add menu, drag-free reordering via ↑ / ↓.
- **Center · Viewport** — WebGL terrain preview. Orbit / pan / zoom, view
  modes (Satmap, Height, Slope, Flow, Sediment, Hillshade), water plane, sun.
- **Right · Inspector** — Frontier-style cards: every erosion type and
  generator exposes its own slider set; layers can carry **masks** (coastal,
  mountain falloff, strata, rifts, cliffs, altitude, slope, flow, noise) and
  **generators** (Perlin, multifractal, ridged, mountain, billow, voronoi…).

## Simulation

- **Hydraulic erosion** — droplet particle simulation with inertia, capacity,
  deposition, evaporation and brush radius; records flow accumulation and
  sediment deposition as terrain signals.
- **Thermal erosion** — talus-angle slumping with material conservation.
- **Wind erosion** — directional abrasion, lee deposition and dune trains.
- **River incision** — flow-accumulation driven channel carving with banks.

## Satmap texturing

Satellite-style texture layers are driven by terrain **signals** (height,
slope / protrusions, rivers & flow, sedimentation, wetness, aspect, ambient
occlusion) picked from a dropdown per layer, ramped into a two-colour blend,
modulated by detail-noise generators and masked with the same mask library.

## Presets

Sandstone Canyons · Sandstone Cliffs · Coastal Cliffs · Himalayan · Icelandic ·
Alps · Snowy Mountains · Rugged Outcrops · Desert Dunes · Rocky Desert.
