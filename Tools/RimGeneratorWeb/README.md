# Slate Rim Forge Web App

A self-contained HTML/CSS/JavaScript front-end for authoring the procedural one-piece Y-spoke rim. It does not create a tyre.

## Run locally

From the repository root:

```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory Tools/RimGeneratorWeb
```

Then open `http://localhost:8080`.

The app has no build step and no npm dependency. The preview uses a small dependency-free canvas renderer so it works from the checked-out project and remains easy to embed in a future Slate content tool.

## Included controls

- Single Y, Compact Y and Aggressive Y construction styles.
- Diameter, width, face dish, bevel, continuous Y spoke count/width/depth.
- Lug count, bolt-circle radius and hex nut radius.
- Brushed silver, gunmetal, satin black, forged bronze and ceramic white materials.
- Machined spoke contrast toggle.
- Orbit, zoom and optional wireframe preview.
- Interactive blank cross-section curve editor for the lip, bead seat and barrel.
- Downloadable JSON build specification for handoff to the Blender generator or game pipeline.

The main preview uses a +X wheel axle, keeps +Z as world up, and renders the rim body, hub ring, nuts, bolt shafts, center cap and inner barrel shading. Every Y branch is built from a single closed silhouette; the UI deliberately does not offer a V plus separate bar construction. Hardware is kept separate and serviceable.
